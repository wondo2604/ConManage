import { db, WEBHOOK_EVENT_CATALOG, setAssetTransactionHook } from './db.js';

export function getGlobalWebhookUrl() {
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'discord_webhook_url'").get();
  return settingRow?.value || process.env.DISCORD_WEBHOOK_URL || '';
}

/**
 * 전체 이벤트별 웹훅 설정 목록 조회 (카탈로그 메타데이터 + DB 저장값 병합)
 */
export function getAllWebhookConfigs() {
  const rows = db.prepare('SELECT * FROM webhook_configs').all();
  const map = new Map(rows.map(r => [r.event_key, r]));

  return WEBHOOK_EVENT_CATALOG.map(meta => {
    const saved = map.get(meta.event_key);
    const defaultColor = meta.default_color || '#3b82f6';
    const savedColor = saved?.embed_color || defaultColor;
    return {
      event_key: meta.event_key,
      name: meta.name,
      label: meta.name,
      category: meta.category,
      description: meta.description,
      enabled: saved ? (saved.enabled ? 1 : 0) : (meta.default_enabled ?? 1),
      webhook_url: saved?.webhook_url || '',
      mention_type: saved?.mention_type || meta.default_mention || 'none',
      custom_mention: saved?.custom_mention || '',
      embed_color: savedColor,
      custom_color: saved?.embed_color && saved.embed_color !== defaultColor ? saved.embed_color : (saved?.embed_color || ''),
      default_color: defaultColor,
      updated_at: saved?.updated_at || null
    };
  });
}

/**
 * 단일 이벤트 웹훅 설정 조회
 */
export function getEventWebhookConfig(eventKey) {
  const meta = WEBHOOK_EVENT_CATALOG.find(m => m.event_key === eventKey);
  const saved = db.prepare('SELECT * FROM webhook_configs WHERE event_key = ?').get(eventKey);
  const defaultColor = meta?.default_color || '#3b82f6';
  const savedColor = saved?.embed_color || defaultColor;

  return {
    event_key: eventKey,
    name: meta?.name || eventKey,
    label: meta?.name || eventKey,
    category: meta?.category || '기타',
    description: meta?.description || '',
    enabled: saved ? (saved.enabled ? 1 : 0) : (meta?.default_enabled ?? 1),
    webhook_url: saved?.webhook_url || '',
    mention_type: saved?.mention_type || meta?.default_mention || 'none',
    custom_mention: saved?.custom_mention || '',
    embed_color: savedColor,
    custom_color: savedColor,
    default_color: defaultColor
  };
}

/**
 * 템플릿 문자열 치환 유틸리티
 */
export function formatNoticeMessage(template, data) {
  if (!template) return data.content || '';
  return template
    .replace(/\{title\}/g, data.title || '')
    .replace(/\{content\}/g, data.content || '')
    .replace(/\{category\}/g, data.category || '')
    .replace(/\{author\}/g, data.author_name || '관리자')
    .replace(/\{date\}/g, new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
}

/**
 * 색상 코드(HEX)를 디스코드 정수형 색상으로 변환
 */
export function hexToIntColor(hex, defaultColor = 0x3b82f6) {
  if (!hex) return defaultColor;
  const cleanHex = String(hex).replace('#', '').trim();
  const parsed = parseInt(cleanHex, 16);
  return isNaN(parsed) ? defaultColor : parsed;
}

/**
 * 디스코드 웹훅 URL 정규화 (구형 도메인 및 공백 정리)
 */
export function normalizeWebhookUrl(rawUrl) {
  if (!rawUrl) return '';
  let url = String(rawUrl).trim();
  url = url.replace(/^https?:\/\/(ptb\.|canary\.)?discordapp\.com\/api\/webhooks\//i, 'https://discord.com/api/webhooks/');
  url = url.replace(/^https?:\/\/(ptb\.|canary\.)?discord\.com\/api\/webhooks\//i, 'https://discord.com/api/webhooks/');
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// 디스코드 웹훅 Rate-Limit(HTTP 429) 방지 큐 · 임베드 마이크로 배칭 · 재시도 & 브라우저 폴백 엔진
// ─────────────────────────────────────────────────────────────────────────────
const MIN_INTERVAL_MS = 500;       // 동일 웹훅 URL 최소 발송 간격 (5req/2s 리밋 여유 확보)
const BATCH_WINDOW_MS = 180;       // 동시 다발 이벤트(원장 입출금 + 보상 알림 등)를 단일 메시지로 묶는 시간 창
const MAX_EMBEDS_PER_MESSAGE = 10; // 디스코드 1회 웹훅 요청당 최대 임베드 수
const MAX_FALLBACK_QUEUE = 40;     // 서버 공유 IP 429 차단 시 클라이언트 브라우저가 대신 전달할 큐 최대 크기

const webhookBuckets = new Map();
const pendingClientFallbacks = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBucket(targetUrl) {
  let bucket = webhookBuckets.get(targetUrl);
  if (!bucket) {
    bucket = {
      nextAllowedAt: 0,
      queue: [],
      processing: false,
      batchTimer: null
    };
    webhookBuckets.set(targetUrl, bucket);
  }
  return bucket;
}

function isCloudflareHtml429(errText = '') {
  const sample = String(errText).slice(0, 600).toLowerCase();
  return sample.includes('<!doctype html') || sample.includes('<html') || sample.includes('error 1015') || sample.includes('cloudflare');
}

function parseRetryAfterMs(res, errText = '') {
  const resetAfterHeader = res.headers?.get?.('x-ratelimit-reset-after');
  if (resetAfterHeader) {
    const sec = parseFloat(resetAfterHeader);
    if (!isNaN(sec) && sec > 0) return Math.ceil(sec * 1000) + 200;
  }

  const retryHeader = res.headers?.get?.('retry-after');
  if (retryHeader) {
    const val = parseFloat(retryHeader);
    if (!isNaN(val) && val > 0) {
      return (val > 500 ? Math.ceil(val) : Math.ceil(val * 1000)) + 200;
    }
  }

  try {
    const body = JSON.parse(errText);
    if (typeof body?.retry_after === 'number' && body.retry_after > 0) {
      const r = body.retry_after;
      return (r > 500 ? Math.ceil(r) : Math.ceil(r * 1000)) + 200;
    }
  } catch (_) {}

  return 2200;
}

export function enqueueClientWebhookFallback(targetUrl, payload, isTest = false) {
  if (!targetUrl || !payload) return;
  const now = Date.now();
  // 5분 이상 지난 오래된 항목 정리
  while (pendingClientFallbacks.length > 0 && now - pendingClientFallbacks[0].createdAt > 5 * 60 * 1000) {
    pendingClientFallbacks.shift();
  }
  if (pendingClientFallbacks.length >= MAX_FALLBACK_QUEUE) {
    pendingClientFallbacks.shift();
  }
  pendingClientFallbacks.push({
    targetUrl,
    payload,
    isTest: Boolean(isTest),
    createdAt: now
  });
}

export function hasPendingWebhookFallbacks() {
  return pendingClientFallbacks.length > 0;
}

export function drainPendingWebhookFallbacks() {
  if (pendingClientFallbacks.length === 0) return [];
  return pendingClientFallbacks.splice(0, pendingClientFallbacks.length);
}

/**
 * 실제 디스코드 웹훅 HTTP POST 수행 (Rate-Limit 헤더 추적 + 429 자동 대기 재시도)
 */
async function deliverPayloadWithRetry(targetUrl, payload, options = {}) {
  const isTest = Boolean(options.isTest);
  const returnFallbackDirect = Boolean(options.returnFallbackDirect || isTest);
  const maxAttempts = isTest ? 3 : 4;
  const bucket = getBucket(targetUrl);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const waitBefore = bucket.nextAllowedAt - Date.now();
    if (waitBefore > 0) {
      // 인터랙티브 요청에서 대기시간이 너무 길면 즉시 클라이언트 브라우저 릴레이로 위임
      if (returnFallbackDirect && waitBefore > 4500) {
        return {
          success: true,
          relayed: true,
          fallback_webhook: { targetUrl, payload, isTest }
        };
      }
      await sleep(Math.min(waitBefore, 10000));
    }

    let res;
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://minecraft-federation.local, 1.0)'
        },
        body: JSON.stringify(payload)
      });
    } catch (netErr) {
      if (attempt < maxAttempts) {
        await sleep(800 * attempt);
        continue;
      }
      throw netErr;
    }

    const remainingHeader = res.headers?.get?.('x-ratelimit-remaining');
    const resetAfterHeader = res.headers?.get?.('x-ratelimit-reset-after');

    if (res.ok) {
      if (remainingHeader !== null && remainingHeader !== undefined && Number(remainingHeader) <= 0) {
        const resetSec = parseFloat(resetAfterHeader) || 2;
        bucket.nextAllowedAt = Math.max(bucket.nextAllowedAt, Date.now() + Math.ceil(resetSec * 1000) + 250);
      } else {
        bucket.nextAllowedAt = Math.max(bucket.nextAllowedAt, Date.now() + MIN_INTERVAL_MS);
      }
      return { success: true };
    }

    const errText = await res.text().catch(() => '');

    if (res.status === 429) {
      const cfBlock = isCloudflareHtml429(errText);
      const retryMs = parseRetryAfterMs(res, errText);
      bucket.nextAllowedAt = Math.max(bucket.nextAllowedAt, Date.now() + Math.min(retryMs, 25000));

      const maxWaitAllowed = isTest ? 4500 : 12000;
      if (!cfBlock && attempt < maxAttempts && retryMs <= maxWaitAllowed) {
        console.warn(`[Discord Webhook 429] Waiting ${retryMs}ms before retry (${attempt}/${maxAttempts})...`);
        await sleep(retryMs);
        continue;
      }

      // Render 등 클라우드 공유 IP의 Cloudflare 1015 차단 또는 장기 429 발생 시 클라이언트 브라우저 폴백 반환/적재
      console.warn(`[Discord Webhook 429 Fallback] Delegating webhook delivery to client browser (cfBlock=${cfBlock}, retryMs=${retryMs}).`);
      if (returnFallbackDirect) {
        return {
          success: true,
          relayed: true,
          status: 429,
          fallback_webhook: { targetUrl, payload, isTest }
        };
      }
      enqueueClientWebhookFallback(targetUrl, payload, false);
      return {
        success: true,
        relayed: true,
        status: 429
      };
    }

    // 429 외의 오류 (400, 401, 404 등)
    bucket.nextAllowedAt = Math.max(bucket.nextAllowedAt, Date.now() + MIN_INTERVAL_MS);
    if (isTest || options.throwOnError) {
      throw new Error(`디스코드 응답 오류 (HTTP ${res.status}): ${errText || res.statusText}`);
    }
    console.error(`[Discord Webhook Error] Status: ${res.status} ${errText}`);
    return { success: false, status: res.status, error: errText || res.statusText };
  }

  return { success: false };
}

/**
 * URL별 큐 워커: 짧은 시간(180ms) 내 발생한 동일 채널 웹훅 임베드들을 최대 10개까지 1회 요청으로 병합 발송
 */
async function processBucketQueue(targetUrl) {
  const bucket = getBucket(targetUrl);
  if (bucket.processing) return;
  bucket.processing = true;

  try {
    while (bucket.queue.length > 0) {
      let batch = [];

      if (bucket.queue[0].isTest || bucket.queue[0].noBatch) {
        batch.push(bucket.queue.shift());
      } else {
        let embedCount = 0;
        while (bucket.queue.length > 0 && !bucket.queue[0].isTest && !bucket.queue[0].noBatch) {
          const nextItem = bucket.queue[0];
          const itemEmbedLen = Array.isArray(nextItem.payload?.embeds) ? nextItem.payload.embeds.length : 0;
          if (batch.length > 0 && embedCount + itemEmbedLen > MAX_EMBEDS_PER_MESSAGE) {
            break;
          }
          batch.push(bucket.queue.shift());
          embedCount += itemEmbedLen;
          if (embedCount >= MAX_EMBEDS_PER_MESSAGE) break;
        }
      }

      if (batch.length === 0) continue;

      let combinedPayload;
      if (batch.length === 1) {
        combinedPayload = batch[0].payload;
      } else {
        // 주요 이벤트(납품/퀘스트/알바/충전/수동정산 등) 임베드가 원장(asset_payout/asset_deduct) 임베드보다 위에 오도록 정렬
        const sorted = [...batch].sort((a, b) => (a.priority || 10) - (b.priority || 10));
        const mentions = [...new Set(sorted.map(item => item.payload?.content).filter(Boolean))];
        const embeds = sorted.flatMap(item => item.payload?.embeds || []).slice(0, MAX_EMBEDS_PER_MESSAGE);
        combinedPayload = {
          content: mentions.length > 0 ? mentions.join(' ') : undefined,
          embeds
        };
      }

      const first = batch[0];
      try {
        const result = await deliverPayloadWithRetry(targetUrl, combinedPayload, {
          isTest: first.isTest,
          returnFallbackDirect: first.returnFallbackDirect,
          throwOnError: first.throwOnError
        });
        batch.forEach(item => item.resolve(result));
      } catch (err) {
        batch.forEach(item => item.reject(err));
      }
    }
  } finally {
    bucket.processing = false;
    if (bucket.queue.length > 0) {
      processBucketQueue(targetUrl);
    }
  }
}

function enqueueWebhookDelivery(targetUrl, payload, options = {}) {
  const normalizedUrl = normalizeWebhookUrl(targetUrl);
  const bucket = getBucket(normalizedUrl);
  const isTest = Boolean(options.isTest);
  const noBatch = Boolean(options.noBatch || isTest);
  const type = options.type || 'general';
  // 원장 자동 기록(asset_payout, asset_deduct)은 우선순위 숫자 20(하단), 주요 이벤트는 5(상단)
  const priority = (type === 'asset_payout' || type === 'asset_deduct') ? 20 : 5;

  return new Promise((resolve, reject) => {
    bucket.queue.push({
      payload,
      type,
      priority,
      isTest,
      noBatch,
      returnFallbackDirect: Boolean(options.returnFallbackDirect || isTest),
      throwOnError: Boolean(options.throwOnError || isTest),
      resolve,
      reject
    });

    if (noBatch) {
      if (bucket.batchTimer) {
        clearTimeout(bucket.batchTimer);
        bucket.batchTimer = null;
      }
      processBucketQueue(normalizedUrl);
    } else if (!bucket.processing && !bucket.batchTimer) {
      bucket.batchTimer = setTimeout(() => {
        bucket.batchTimer = null;
        processBucketQueue(normalizedUrl);
      }, BATCH_WINDOW_MS);
    }
  });
}

/**
 * 멘션 접두사 생성
 */
function buildMentionContent(mentionType, customMention = '', isTest = false) {
  let mention = '';
  if (mentionType === 'everyone') {
    mention = '@everyone';
  } else if (mentionType === 'here') {
    mention = '@here';
  } else if (mentionType === 'custom' && customMention && customMention.trim()) {
    mention = customMention.trim();
  } else if (mentionType && mentionType !== 'none' && mentionType !== 'custom') {
    mention = String(mentionType).trim();
  }
  const testPrefix = isTest ? '🧪 **[웹훅 연동 테스트 발송]**' : '';
  return [mention, testPrefix].filter(Boolean).join(' ').trim() || undefined;
}

/**
 * 공지사항 전용 디스코드 웹훅 발송 함수
 */
export async function sendNoticeDiscordWebhook(noticeData, options = {}) {
  const globalUrl = getGlobalWebhookUrl();
  const rawTargetUrl = (noticeData.webhook_url && noticeData.webhook_url.trim()) ? noticeData.webhook_url.trim() : globalUrl;
  const targetUrl = normalizeWebhookUrl(rawTargetUrl);

  if (!targetUrl) {
    throw new Error('등록된 디스코드 웹훅 URL이 없습니다. 개별 웹훅 URL을 입력하거나 전역 웹훅 URL을 먼저 설정해주세요.');
  }

  const isTest = options.isTest || false;
  const mentionType = noticeData.mention_type || 'none';
  const finalContent = buildMentionContent(mentionType, noticeData.custom_mention || '', isTest);

  const formattedDescription = formatNoticeMessage(noticeData.message_template, noticeData);
  const embedColor = hexToIntColor(noticeData.embed_color, 0x3b82f6);

  const payload = {
    content: finalContent,
    embeds: [{
      title: `${isTest ? '🧪 [테스트] ' : '📢 '}${noticeData.title || '공지사항'}`,
      description: formattedDescription,
      color: embedColor,
      fields: [
        { name: '구분', value: noticeData.category_display || noticeData.category || '공지', inline: true },
        { name: '작성/수정자', value: noticeData.author_name || '관리자', inline: true },
        { name: '일시', value: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), inline: true }
      ],
      footer: { text: '마인크래프트 연방 관리 플랫폼' },
      timestamp: new Date().toISOString()
    }]
  };

  return enqueueWebhookDelivery(targetUrl, payload, {
    type: 'notice',
    isTest,
    noBatch: true,
    returnFallbackDirect: true,
    throwOnError: true
  });
}

/**
 * 이벤트별 디스코드 임베드 빌더 (26종 전체 지원)
 */
function buildEventEmbed(type, data = {}, colorInt = 0x3b82f6) {
  const nowKst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  switch (type) {
    // 1. 통합 포인트·크레딧 지급(+) 원장 기록
    case 'asset_payout': {
      const isPoint = data.asset_type === 'POINT' || data.asset_type === 'POINTS';
      const unit = isPoint ? 'P' : 'C';
      const assetLabel = isPoint ? '연방 포인트 (P)' : '크레딧 (C)';
      return {
        title: `💰 [재화 지급 기록 #${data.id || '-'}] ${data.nickname || data.username || '플레이어'} (+${Number(data.amount || 0).toLocaleString()} ${unit})`,
        description: data.description || '재화가 지급되어 원장에 기록되었습니다.',
        color: colorInt,
        fields: [
          { name: '지급 대상', value: `${data.nickname || data.username || '-'} (@${data.username || '-'})`, inline: true },
          { name: '자산 종류', value: assetLabel, inline: true },
          { name: '지급 수량', value: `+${Number(data.amount || 0).toLocaleString()} ${unit}`, inline: true },
          { name: '잔액 변동 (전 → 후)', value: `${Number(data.balance_before || 0).toLocaleString()} ${unit} → **${Number(data.balance_after || 0).toLocaleString()} ${unit}**`, inline: true },
          { name: '분류 카테고리', value: data.category || '지급', inline: true },
          { name: '지급 처리자', value: data.actor_name || '시스템', inline: true }
        ]
      };
    }

    // 2. 통합 포인트·크레딧 차감/사용(-) 원장 기록
    case 'asset_deduct': {
      const isPoint = data.asset_type === 'POINT' || data.asset_type === 'POINTS';
      const unit = isPoint ? 'P' : 'C';
      const assetLabel = isPoint ? '연방 포인트 (P)' : '크레딧 (C)';
      return {
        title: `💸 [재화 차감/사용 기록 #${data.id || '-'}] ${data.nickname || data.username || '플레이어'} (-${Number(data.amount || 0).toLocaleString()} ${unit})`,
        description: data.description || '재화가 차감/사용되어 원장에 기록되었습니다.',
        color: colorInt,
        fields: [
          { name: '대상 유저', value: `${data.nickname || data.username || '-'} (@${data.username || '-'})`, inline: true },
          { name: '자산 종류', value: assetLabel, inline: true },
          { name: '차감 수량', value: `-${Number(data.amount || 0).toLocaleString()} ${unit}`, inline: true },
          { name: '잔액 변동 (전 → 후)', value: `${Number(data.balance_before || 0).toLocaleString()} ${unit} → **${Number(data.balance_after || 0).toLocaleString()} ${unit}**`, inline: true },
          { name: '분류 카테고리', value: data.category || '차감/사용', inline: true },
          { name: '처리자', value: data.actor_name || '시스템', inline: true }
        ]
      };
    }

    // 3. 관리자 수동 재화 지급·차감 및 수기 정산
    case 'manual_adjust': {
      return {
        title: `🛠️ [관리자 수동 지급/정산] ${data.target_name || '플레이어'}`,
        description: data.reason || data.description || '관리자에 의해 재화 수치가 수동 조정되었습니다.',
        color: colorInt,
        fields: [
          { name: '대상 플레이어', value: `${data.target_name || '-'} (@${data.target_username || '-'})`, inline: true },
          { name: '포인트 변동', value: data.point_diff_text || '-', inline: true },
          { name: '크레딧 변동', value: data.credit_diff_text || '-', inline: true },
          { name: '조정 후 보유 재화', value: `${Number(data.after_points ?? 0).toLocaleString()} P / ${Number(data.after_credits ?? 0).toLocaleString()} C`, inline: true },
          { name: '구분', value: data.category || '관리자 수동 정산', inline: true },
          { name: '실행 관리자', value: data.actor_name || '관리자', inline: true }
        ]
      };
    }

    // 4. 물자 납품 승인 및 보상 지급 기록
    case 'supply_reward': {
      return {
        title: `📦 [물자 납품 보상 지급] ${data.supply_name || '납품 품목'} (#${data.request_id || '-'})`,
        description: data.admin_comment ? `💬 심사 코멘트: ${data.admin_comment}` : '물자 납품이 승인되어 보상이 지급되었습니다.',
        color: colorInt,
        fields: [
          { name: '납품 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '품목 및 수량', value: `${data.supply_name || '-'} (${data.amount || 0}${data.unit || '개'})`, inline: true },
          { name: '상자 위치', value: data.chest_location || '-', inline: true },
          { name: '지급 연방 포인트', value: `+${Number(data.points_earned || 0).toLocaleString()} P`, inline: true },
          { name: '지급 크레딧', value: `+${Number(data.credits_earned || 0).toLocaleString()} C`, inline: true },
          { name: '승인 담당관', value: data.reviewer_name || '관리자', inline: true }
        ]
      };
    }

    // 5. 퀘스트 완수 승인 및 보상 지급 기록
    case 'quest_reward': {
      return {
        title: `⚔️ [퀘스트 보상 지급] ${data.quest_title || '퀘스트'} (#${data.submission_id || '-'})`,
        description: data.admin_comment ? `💬 심사 코멘트: ${data.admin_comment}` : '퀘스트 완수가 승인되어 보상이 지급되었습니다.',
        color: colorInt,
        fields: [
          { name: '완수 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '퀘스트명', value: data.quest_title || '-', inline: true },
          { name: '심사 담당관', value: data.reviewer_name || '관리자', inline: true },
          { name: '지급 연방 포인트', value: `+${Number(data.points_earned || 0).toLocaleString()} P`, inline: true },
          { name: '지급 크레딧', value: `+${Number(data.credits_earned || 0).toLocaleString()} C`, inline: true }
        ]
      };
    }

    // 6. 단기 알바 완료 승인 및 보수·포인트 지급 기록
    case 'job_payout': {
      return {
        title: `⛏️ [단기 알바 보수·포인트 지급] ${data.work_type || '알바'} (#${data.job_id || '-'})`,
        description: data.description || '단기 알바 작업이 최종 승인되어 근로자에게 보수와 포인트가 지급되었습니다.',
        color: colorInt,
        fields: [
          { name: '근로자 (수령자)', value: `${data.worker_name || '-'} (@${data.worker_username || '-'})`, inline: true },
          { name: '고용주 (사업가)', value: data.employer_name || '-', inline: true },
          { name: '최종 승인자', value: data.reviewer_name || '기업 관리자', inline: true },
          { name: '지급 보수(크레딧)', value: `+${Number(data.pay_credit || 0).toLocaleString()} C`, inline: true },
          { name: '지급 연방 포인트', value: `+${Number(data.federation_points || 0).toLocaleString()} P`, inline: true }
        ]
      };
    }

    // 7. 전체 플레이어 일괄 포인트·크레딧 지급/조정
    case 'ranking_bulk_adjust': {
      return {
        title: `🎁 [전체 플레이어 일괄 지급/조정] ${data.action_label || '일괄 조정'}`,
        description: data.reason || '전체 승인 플레이어를 대상으로 재화/점수가 일괄 조정되었습니다.',
        color: colorInt,
        fields: [
          { name: '작업 유형', value: data.action_label || '-', inline: true },
          { name: '적용 수치', value: String(data.value_text || data.value || '-'), inline: true },
          { name: '대상 인원', value: `${data.target_count || 0}명`, inline: true },
          { name: '실행 관리자', value: data.actor_name || '관리자', inline: true },
          { name: '일시', value: nowKst, inline: true }
        ]
      };
    }

    // 8. 크레딧 충전 신청 접수
    case 'credit_charge_request': {
      return {
        title: `💳 [크레딧 충전 신청 #${data.id || '-'}] ${data.nickname || '플레이어'}`,
        description: data.notes ? `📝 메모: ${data.notes}` : '새로운 크레딧 충전 신청이 접수되었습니다.',
        color: colorInt,
        fields: [
          { name: '신청자 (인게임 닉네임)', value: `${data.nickname || '-'} (@${data.username || '-'})`, inline: true },
          { name: '신청 크레딧', value: `${Number(data.amount || 0).toLocaleString()} C`, inline: true },
          { name: '송금/충전 일시', value: data.charge_datetime || '-', inline: true }
        ]
      };
    }

    // 9. 크레딧 충전 승인(지급) 및 반려 처리
    case 'credit_charge_review': {
      const isApproved = data.status === 'approved';
      return {
        title: `${isApproved ? '✅ [크레딧 충전 지급 완료]' : '❌ [크레딧 충전 반려]'} #${data.id || '-'} (${data.nickname || '플레이어'})`,
        description: data.admin_comment ? `💬 관리자 코멘트: ${data.admin_comment}` : (isApproved ? '크레딧 충전이 승인되어 지급 완료되었습니다.' : '크레딧 충전 신청이 반려되었습니다.'),
        color: colorInt,
        fields: [
          { name: '대상 플레이어', value: `${data.nickname || '-'} (@${data.username || '-'})`, inline: true },
          { name: '처리 상태', value: isApproved ? '승인 및 지급 완료' : '반려(거절)', inline: true },
          { name: '처리 담당관', value: data.reviewer_name || '크레딧 관리자', inline: true },
          { name: '지급 크레딧', value: isApproved ? `+${Number(data.approved_amount || 0).toLocaleString()} C` : '0 C', inline: true },
          { name: '보너스 포인트', value: isApproved && data.bonus_points ? `+${Number(data.bonus_points).toLocaleString()} P` : '0 P', inline: true }
        ]
      };
    }

    // 10. 크레딧 환전(출금) 신청 접수
    case 'credit_exchange_request': {
      return {
        title: `🏦 [크레딧 환전 신청 #${data.id || '-'}] ${data.in_game_name || '플레이어'}`,
        description: '인게임 화폐로의 크레딧 환전(출금) 신청이 접수되었습니다.',
        color: colorInt,
        fields: [
          { name: '신청자', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '인게임 수령 닉네임', value: data.in_game_name || '-', inline: true },
          { name: '환전 신청 크레딧', value: `${Number(data.amount || 0).toLocaleString()} C`, inline: true }
        ]
      };
    }

    // 11. 크레딧 환전 지급 완료 및 반려(환불) 처리
    case 'credit_exchange_review': {
      const isCompleted = data.status === 'completed';
      return {
        title: `${isCompleted ? '💸 [크레딧 환전 지급 완료]' : '↩️ [크레딧 환전 반려·환불]'} #${data.id || '-'}`,
        description: data.admin_comment ? `💬 관리자 코멘트: ${data.admin_comment}` : (isCompleted ? '인게임 화폐 송금 및 환전 처리가 완료되었습니다.' : '환전 요청이 반려되어 크레딧이 환불되었습니다.'),
        color: colorInt,
        fields: [
          { name: '대상 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '인게임 닉네임', value: data.in_game_name || '-', inline: true },
          { name: '환전 크레딧', value: `${Number(data.amount || 0).toLocaleString()} C`, inline: true },
          { name: '처리 결과', value: isCompleted ? '지급 완료' : '반려 (크레딧 환불)', inline: true },
          { name: '처리 담당관', value: data.reviewer_name || '크레딧 관리자', inline: true }
        ]
      };
    }

    // 12. 신규 물자 납품 신청 접수
    case 'supply_request': {
      return {
        title: `📥 [물자 납품 신청 #${data.id || '-'}] ${data.supply_name || '납품 품목'}`,
        description: data.notes ? `📝 비고: ${data.notes}` : '새로운 물자 납품 신청이 접수되었습니다.',
        color: colorInt,
        fields: [
          { name: '신청 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '납품 구분', value: data.is_custom ? '자율 직접 입력 납품' : '지정 품목 납품', inline: true },
          { name: '품목 및 수량', value: `${data.supply_name || '-'} (${data.amount || 0}${data.unit || '개'})`, inline: true },
          { name: '상자 위치', value: data.chest_location || '-', inline: true }
        ]
      };
    }

    // 13. 물자 납품 반려(거절) 처리
    case 'supply_rejected': {
      return {
        title: `❌ [물자 납품 반려 #${data.request_id || '-'}] ${data.supply_name || '납품 품목'}`,
        description: data.admin_comment ? `사유: ${data.admin_comment}` : '물자 납품 신청이 반려되었습니다.',
        color: colorInt,
        fields: [
          { name: '신청 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '품목 및 수량', value: `${data.supply_name || '-'} (${data.amount || 0}${data.unit || '개'})`, inline: true },
          { name: '심사 담당관', value: data.reviewer_name || '관리자', inline: true }
        ]
      };
    }

    // 14. 신규 납품 대상 품목 등록
    case 'supply_item_created': {
      return {
        title: `📋 [신규 납품 품목 등록] ${data.name || '품목'}`,
        description: data.description || '새로운 납품 대상 물자 품목이 등록되었습니다.',
        color: colorInt,
        fields: [
          { name: '품목명', value: data.name || '-', inline: true },
          { name: '단위당 연방 포인트', value: `${Number(data.points_per_unit || 0).toLocaleString()} P / ${data.unit || '개'}`, inline: true },
          { name: '단위당 크레딧', value: `${Number(data.credits_per_unit || 0).toLocaleString()} C / ${data.unit || '개'}`, inline: true },
          { name: '등록 관리자', value: data.actor_name || '납품 관리자', inline: true }
        ]
      };
    }

    // 15. 포인트 상점 아이템 구매 신청
    case 'shop_purchase': {
      return {
        title: `🛒 [포인트 상점 구매 신청 #${data.order_id || '-'}] ${data.item_name || '상품'}`,
        description: '플레이어가 연방 포인트 상점에서 상품을 구매 신청했습니다.',
        color: colorInt,
        fields: [
          { name: '구매자', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '구매 상품', value: data.item_name || '-', inline: true },
          { name: '사용 포인트', value: `${Number(data.points_spent || 0).toLocaleString()} P`, inline: true },
          { name: '구매 후 잔여 포인트', value: `${Number(data.remaining_points ?? 0).toLocaleString()} P`, inline: true }
        ]
      };
    }

    // 16. 포인트 상점 상품 지급 완료 및 주문 취소(환불)
    case 'shop_delivery': {
      const isCancelled = data.status === 'cancelled';
      return {
        title: `${isCancelled ? '↩️ [상점 주문 취소·환불]' : '🎁 [상점 상품 지급 완료]'} #${data.order_id || '-'} (${data.item_name || '상품'})`,
        description: isCancelled
          ? '상점 주문이 취소되어 사용했던 연방 포인트가 환불되었습니다.'
          : '상점 구매 상품이 플레이어에게 지급 완료 처리되었습니다.',
        color: colorInt,
        fields: [
          { name: '주문자', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '상품명', value: data.item_name || '-', inline: true },
          { name: '포인트', value: `${isCancelled ? '+' : ''}${Number(data.points_spent || 0).toLocaleString()} P ${isCancelled ? '(환불)' : '(사용)'}`, inline: true },
          { name: '처리 담당관', value: data.actor_name || '샵 관리자', inline: true }
        ]
      };
    }

    // 17. 신규 공통 퀘스트 등록
    case 'quest': {
      return {
        title: `⚔️ [신규 퀘스트] ${data.title || '퀘스트'}`,
        description: data.reward_text || '새로운 공통 퀘스트가 활성화되었습니다.',
        color: colorInt,
        fields: [
          { name: '목표 결과물', value: data.target_item || '-', inline: true },
          { name: '보상 크레딧', value: `${Number(data.credit_reward || 0).toLocaleString()} C`, inline: true },
          { name: '보상 연방 포인트', value: `${Number(data.point_reward || 0).toLocaleString()} P`, inline: true },
          { name: '기타 사항', value: data.notes || '없음' }
        ]
      };
    }

    // 18. 퀘스트 완료 인증 제출 접수
    case 'quest_submission': {
      return {
        title: `📝 [퀘스트 완료 제출 #${data.id || '-'}] ${data.quest_title || '퀘스트'}`,
        description: data.proof_text || '플레이어가 퀘스트 완료 증빙을 제출했습니다.',
        color: colorInt,
        fields: [
          { name: '제출 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '퀘스트명', value: data.quest_title || '-', inline: true },
          { name: '기본 보상', value: `${Number(data.point_reward || 0).toLocaleString()} P / ${Number(data.credit_reward || 0).toLocaleString()} C`, inline: true }
        ]
      };
    }

    // 19. 퀘스트 완료 인증 반려(거절) 처리
    case 'quest_rejected': {
      return {
        title: `❌ [퀘스트 인증 반려 #${data.submission_id || '-'}] ${data.quest_title || '퀘스트'}`,
        description: data.admin_comment ? `사유: ${data.admin_comment}` : '퀘스트 완료 인증 제출이 반려되었습니다.',
        color: colorInt,
        fields: [
          { name: '제출 플레이어', value: `${data.user_name || '-'} (@${data.username || '-'})`, inline: true },
          { name: '퀘스트명', value: data.quest_title || '-', inline: true },
          { name: '심사 담당관', value: data.reviewer_name || '퀘스트 관리자', inline: true }
        ]
      };
    }

    // 20. 단기 알바 구인 승인 및 공개 모집
    case 'part_time_job': {
      return {
        title: `💼 [단기 알바 구인 공개] ${data.work_type || '알바'} (${data.employer_name || '사업가'})`,
        description: data.description || '단기 알바 구인이 승인되어 모집이 시작되었습니다.',
        color: colorInt,
        fields: [
          { name: '보수(크레딧)', value: `${Number(data.pay_credit || 0).toLocaleString()} C`, inline: true },
          { name: '연방 포인트', value: `${Number(data.federation_points || 0).toLocaleString()} P`, inline: true },
          { name: '작업 일시', value: data.work_date || '-', inline: true },
          { name: '소요 기간', value: data.duration_text || '-', inline: true },
          { name: '특이사항', value: data.notes || '없음' }
        ]
      };
    }

    // 21. 단기 알바 구인 등록 신청 (승인 대기)
    case 'job_request': {
      return {
        title: `📋 [단기 알바 구인 신청 #${data.id || '-'}] ${data.work_type || '알바'}`,
        description: data.description || '사업가가 새로운 단기 알바 구인을 신청했습니다 (기업 관리자 승인 대기).',
        color: colorInt,
        fields: [
          { name: '고용주 (사업가)', value: `${data.employer_name || '-'} (@${data.employer_username || '-'})`, inline: true },
          { name: '희망 보수', value: `${Number(data.pay_credit || 0).toLocaleString()} C`, inline: true },
          { name: '작업 일시 / 기간', value: `${data.work_date || '-'} (${data.duration_text || '-'})`, inline: true }
        ]
      };
    }

    // 22. 단기 알바 지원 채용 및 작업 완료 보고
    case 'job_progress': {
      return {
        title: `🔔 [단기 알바 진행 알림 #${data.job_id || '-'}] ${data.stage_label || '상태 변경'}`,
        description: data.description || '단기 알바 진행 상태가 변경되었습니다.',
        color: colorInt,
        fields: [
          { name: '알바 종류', value: data.work_type || '-', inline: true },
          { name: '진행 단계', value: data.stage_label || '-', inline: true },
          { name: '실행자', value: data.actor_name || '-', inline: true }
        ]
      };
    }

    // 23. 캘린더 신규 일정 등록
    case 'schedule': {
      return {
        title: `📅 [일정 등록] ${data.title || '신규 일정'}`,
        description: data.description || '등록된 상세 설명이 없습니다.',
        color: colorInt,
        fields: [
          { name: '분류', value: data.category || '일반', inline: true },
          { name: '일자', value: `${data.start_date || '-'}${data.end_date && data.end_date !== data.start_date ? ' ~ ' + data.end_date : ''}`, inline: true },
          { name: '시간', value: data.start_time ? `${data.start_time}${data.end_time ? ' ~ ' + data.end_time : ''}` : '종일', inline: true }
        ]
      };
    }

    // 24. 시즌 시작·활성화 및 랭킹/재화 초기화
    case 'season_change': {
      return {
        title: `🏆 [시즌/랭킹 관리 알림] ${data.action_title || '시즌 상태 변경'}`,
        description: data.description || '시즌 또는 랭킹 설정이 업데이트되었습니다.',
        color: colorInt,
        fields: [
          { name: '구분', value: data.action_title || '-', inline: true },
          { name: '대상 시즌/범위', value: data.season_name || '-', inline: true },
          { name: '실행 관리자', value: data.actor_name || '관리자', inline: true }
        ]
      };
    }

    // 25. 신규 회원가입 신청 및 가입 승인·거절
    case 'user_register': {
      return {
        title: `👤 [계정 관리 알림] ${data.action_title || '회원가입 알림'}`,
        description: data.description || '사용자 계정 상태가 변경되었습니다.',
        color: colorInt,
        fields: [
          { name: '대상 계정', value: `${data.nickname || data.username || '-'} (@${data.username || '-'})`, inline: true },
          { name: '상태', value: data.status_label || '-', inline: true },
          { name: '처리자', value: data.actor_name || '시스템', inline: true }
        ]
      };
    }

    // 26. 개인별 역할(랭크) 부여 및 역할 설정 변경
    case 'role_change': {
      return {
        title: `🛡️ [역할(랭크) 관리 알림] ${data.action_title || '역할 변경'}`,
        description: data.description || '역할 또는 사용자별 부여 역할이 변경되었습니다.',
        color: colorInt,
        fields: [
          { name: '대상', value: data.target_name || '-', inline: true },
          { name: '변경 내용', value: data.detail || '-', inline: true },
          { name: '실행 관리자', value: data.actor_name || '관리자', inline: true }
        ]
      };
    }

    default: {
      return {
        title: `🔔 [시스템 알림] ${data.title || type}`,
        description: data.description || '새로운 이벤트가 발생했습니다.',
        color: colorInt,
        fields: [
          { name: '이벤트 키', value: type, inline: true },
          { name: '일시', value: nowKst, inline: true }
        ]
      };
    }
  }
}

/**
 * 범용 이벤트 디스코드 웹훅 발송 (26종 개별 설정 지원)
 */
export async function sendDiscordWebhook(type, data = {}, options = {}) {
  try {
    const cfg = getEventWebhookConfig(type);
    const isTest = options.isTest || false;

    // 테스트 발송이 아닐 때 비활성화된 이벤트는 전송 생략
    if (!isTest && !cfg.enabled) {
      return { skipped: true, reason: 'disabled' };
    }

    const overrideUrl = options.webhook_url !== undefined ? options.webhook_url : cfg.webhook_url;
    const globalUrl = getGlobalWebhookUrl();
    const rawTargetUrl = (overrideUrl && String(overrideUrl).trim()) ? String(overrideUrl).trim() : globalUrl;
    const targetUrl = normalizeWebhookUrl(rawTargetUrl);

    if (!targetUrl) {
      if (isTest) {
        throw new Error('전송할 디스코드 웹훅 URL이 설정되어 있지 않습니다. 개별 웹훅 URL 또는 상단 전역 기본 웹훅 URL을 먼저 입력해주세요.');
      }
      return { skipped: true, reason: 'no_url' };
    }

    const mentionType = options.mention_type || cfg.mention_type || 'none';
    const customMention = options.custom_mention !== undefined ? options.custom_mention : (cfg.custom_mention || '');
    const colorHex = options.embed_color || cfg.embed_color || '#3b82f6';
    const colorInt = hexToIntColor(colorHex, 0x3b82f6);

    const embed = buildEventEmbed(type, data, colorInt);
    if (isTest) {
      embed.title = `🧪 [테스트] ${embed.title}`;
    }
    embed.footer = { text: `마인크래프트 연방 관리 플랫폼 · [${cfg.category}] ${cfg.name}` };
    embed.timestamp = new Date().toISOString();

    const payload = {
      content: buildMentionContent(mentionType, customMention, isTest),
      embeds: [embed]
    };

    return await enqueueWebhookDelivery(targetUrl, payload, {
      type,
      isTest,
      noBatch: isTest,
      returnFallbackDirect: isTest,
      throwOnError: isTest
    });
  } catch (err) {
    if (options.isTest) throw err;
    console.error(`[Discord Webhook Error] (${type})`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 개별 이벤트 테스트 발송용 샘플 데이터 생성기
 */
export async function sendTestEventWebhook(eventKey, overrides = {}, actorUser = null) {
  const normalizedOverrides = typeof overrides === 'string'
    ? (overrides.trim() ? { webhook_url: overrides.trim() } : {})
    : (overrides || {});
  const actorName = actorUser ? `${actorUser.nickname || actorUser.username} (@${actorUser.username})` : '슈퍼관리자 (@admin)';
  const sampleData = {
    id: 101,
    request_id: 101,
    submission_id: 101,
    job_id: 101,
    order_id: 101,
    username: 'steve_hero',
    nickname: '다이아광부',
    user_name: '다이아광부',
    target_name: '다이아광부',
    target_username: 'steve_hero',
    worker_name: '성실한광부',
    worker_username: 'miner01',
    employer_name: '연방상단장',
    employer_username: 'merchant01',
    in_game_name: '다이아광부',
    asset_type: eventKey === 'asset_deduct' ? 'CREDIT' : 'POINT',
    tx_type: eventKey === 'asset_deduct' ? 'OUT' : 'IN',
    amount: 500,
    balance_before: 1200,
    balance_after: eventKey === 'asset_deduct' ? 700 : 1700,
    category: '테스트 지급/정산',
    description: '개별 웹훅 설정이 정상적으로 디스코드 채널에 연동되었는지 확인하는 테스트 메시지입니다.',
    reason: '이벤트 포상금 수동 지급 테스트',
    point_diff_text: '+500 P',
    credit_diff_text: '+10,000 C',
    after_points: 1700,
    after_credits: 35000,
    supply_name: '철 주괴 64세트',
    unit: '세트',
    chest_location: 'X: 120, Y: 65, Z: -340 (중앙 창고 3번 상자)',
    points_earned: 300,
    credits_earned: 5000,
    reviewer_name: actorName,
    actor_name: actorName,
    quest_title: '전선 보급용 화약 5셋 확보 작전',
    target_item: '화약 5세트',
    reward_text: '작전 성공 시 연방 포인트 및 군자금 즉시 지급',
    point_reward: 400,
    credit_reward: 8000,
    work_type: '광물 채굴',
    pay_credit: 15000,
    federation_points: 250,
    work_date: new Date().toISOString().slice(0, 10),
    duration_text: '약 2시간',
    action_label: '전체 플레이어 연방 포인트 일괄 지급',
    value_text: '+200 P',
    target_count: 12,
    charge_datetime: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    approved_amount: 20000,
    bonus_points: 100,
    status: 'approved',
    name: '네더라이트 주괴',
    points_per_unit: 150,
    credits_per_unit: 3000,
    item_name: '인챈트된 다이아몬드 곡괭이',
    points_spent: 800,
    remaining_points: 900,
    stage_label: '구직자 채용 및 작업 착수',
    title: '주말 국가 총력전 방어 훈련',
    start_date: new Date().toISOString().slice(0, 10),
    start_time: '20:00',
    end_time: '22:00',
    action_title: '테스트 이벤트 발송',
    season_name: '제1회 연방 시즌',
    status_label: '가입 승인 완료',
    detail: '물자 보급관 역할 부여'
  };

  const res = await sendDiscordWebhook(eventKey, sampleData, {
    ...normalizedOverrides,
    isTest: true
  });
  return { ...res, ok: Boolean(res?.success) };
}

// SQLite 원장(recordAssetTransaction) 기록 시 자동으로 지급(asset_payout) / 차감(asset_deduct) 웹훅 발송 연동
setAssetTransactionHook((tx) => {
  const eventKey = tx.tx_type === 'IN' ? 'asset_payout' : 'asset_deduct';
  sendDiscordWebhook(eventKey, tx);
});
