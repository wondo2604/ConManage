import { db } from './db.js';

export function getGlobalWebhookUrl() {
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'discord_webhook_url'").get();
  return settingRow?.value || process.env.DISCORD_WEBHOOK_URL || '';
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
  const cleanHex = hex.replace('#', '').trim();
  const parsed = parseInt(cleanHex, 16);
  return isNaN(parsed) ? defaultColor : parsed;
}

/**
 * 공지사항 전용 디스코드 웹훅 발송 함수
 */
export async function sendNoticeDiscordWebhook(noticeData, options = {}) {
  const globalUrl = getGlobalWebhookUrl();
  const targetUrl = (noticeData.webhook_url && noticeData.webhook_url.trim()) ? noticeData.webhook_url.trim() : globalUrl;

  if (!targetUrl) {
    throw new Error('등록된 디스코드 웹훅 URL이 없습니다. 개별 웹훅 URL을 입력하거나 전역 웹훅 URL을 먼저 설정해주세요.');
  }

  const isTest = options.isTest || false;
  const mentionType = noticeData.mention_type || 'none';
  let mentionContent = '';
  if (mentionType === 'everyone') {
    mentionContent = '@everyone ';
  } else if (mentionType === 'here') {
    mentionContent = '@here ';
  }

  const prefix = isTest ? '🧪 [테스트 발송] ' : '';
  const finalContent = `${mentionContent}${prefix}`.trim();

  const formattedDescription = formatNoticeMessage(noticeData.message_template, noticeData);
  const embedColor = hexToIntColor(noticeData.embed_color, 0x3b82f6);

  const payload = {
    content: finalContent || undefined,
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

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`디스코드 웹훅 전송 실패 (상태 코드: ${res.status}): ${errorText || res.statusText}`);
  }

  return { success: true };
}

/**
 * 범용 이벤트 디스코드 웹훅 발송 (알바, 일정, 퀘스트 등)
 */
export async function sendDiscordWebhook(type, data) {
  try {
    const webhookUrl = getGlobalWebhookUrl();
    if (!webhookUrl) {
      console.log(`[Discord Webhook] No URL configured. Skipping notification for ${type}`);
      return;
    }

    let payload = {};

    if (type === 'part_time_job') {
      // 멘션 불포함
      payload = {
        embeds: [{
          title: `💼 [단기 알바 구인] ${data.work_type} (${data.employer_name || '사업가'})`,
          description: data.description,
          color: 0x3b82f6,
          fields: [
            { name: '보수(크레딧)', value: `${Number(data.pay_credit || 0).toLocaleString()} C`, inline: true },
            { name: '연방 포인트', value: `${data.federation_points} P`, inline: true },
            { name: '일시', value: data.work_date, inline: true },
            { name: '지속 기간', value: data.duration_text, inline: true },
            { name: '특이사항', value: data.notes || '없음' }
          ],
          footer: { text: '마인크래프트 관리 플랫폼' },
          timestamp: new Date().toISOString()
        }]
      };
    } else if (type === 'schedule') {
      // everyone 멘션 포함
      payload = {
        content: '@everyone 새로운 일정이 등록되었습니다!',
        embeds: [{
          title: `📅 [일정 등록] ${data.title}`,
          description: data.description || '등록된 상세 설명이 없습니다.',
          color: 0x10b981,
          fields: [
            { name: '분류', value: data.category || '일반', inline: true },
            { name: '일자', value: `${data.start_date}${data.end_date && data.end_date !== data.start_date ? ' ~ ' + data.end_date : ''}`, inline: true },
            { name: '시간', value: data.start_time ? `${data.start_time}${data.end_time ? ' ~ ' + data.end_time : ''}` : '종일', inline: true }
          ],
          footer: { text: '마인크래프트 관리 플랫폼' },
          timestamp: new Date().toISOString()
        }]
      };
    } else if (type === 'quest') {
      // 멘션 불포함
      payload = {
        embeds: [{
          title: `⚔️ [신규 퀘스트] ${data.title}`,
          description: data.reward_text || '퀘스트가 활성화되었습니다.',
          color: 0xf59e0b,
          fields: [
            { name: '목표 결과물', value: data.target_item || '-', inline: true },
            { name: '보상 크레딧', value: `${Number(data.credit_reward || 0).toLocaleString()} C`, inline: true },
            { name: '보상 연방 포인트', value: `${data.point_reward} P`, inline: true },
            { name: '기타 사항', value: data.notes || '없음' }
          ],
          footer: { text: '마인크래프트 관리 플랫폼' },
          timestamp: new Date().toISOString()
        }]
      };
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error(`[Discord Webhook Error] Status: ${res.status}`);
    }
  } catch (err) {
    console.error('[Discord Webhook Error]', err.message);
  }
}
