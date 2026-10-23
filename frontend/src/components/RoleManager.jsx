import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api';
import { Shield, Plus, GripVertical, ChevronUp, ChevronDown, Trash2, Save, Lock, Users, X, CheckCircle2 } from 'lucide-react';

const PRESET_COLORS = ['#99aab5', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#607d8b'];

/**
 * 디스코드 스타일 역할 관리
 *  - 왼쪽: 역할 목록 (위로 갈수록 높은 역할, 드래그 또는 ▲▼ 로 순서 변경)
 *  - 오른쪽: 선택한 역할의 표시(이름·색상) / 권한 / 멤버 편집
 */
export default function RoleManager({ user, users, onChanged, refreshKey = 0 }) {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [order, setOrder] = useState([]); // 화면상 순서 (위 → 아래)
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ name: '', color: '#99aab5', permissions: [] });
  const [panel, setPanel] = useState('display'); // 'display' | 'permissions' | 'members'
  const [dragId, setDragId] = useState(null);
  const [memberToAdd, setMemberToAdd] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoSaveText, setAutoSaveText] = useState('💾 SQLite 실시간 자동저장');
  const autoSaveTimerRef = useRef(null);

  const canManage = user.is_admin || user.permissions?.includes('역할 관리');

  const load = async (keepSelection = true) => {
    const [r, c] = await Promise.all([apiRequest('/roles'), apiRequest('/permissions')]);
    setRoles(r || []);
    setCatalog(c || []);
    setOrder((r || []).map(x => x.id));
    if (!keepSelection || !r.some(x => x.id === selectedId)) {
      setSelectedId(r?.[0]?.id ?? null);
    }
  };

  useEffect(() => { load(false).catch(err => alert(err.message)); }, []);
  useEffect(() => { if (refreshKey > 0) load(true).catch(() => {}); }, [refreshKey]);

  const roleById = useMemo(() => Object.fromEntries(roles.map(r => [r.id, r])), [roles]);
  const selected = selectedId ? roleById[selectedId] : null;
  const orderDirty = order.some((id, i) => roles[i]?.id !== id);

  useEffect(() => {
    if (selected) {
      setForm({ name: selected.name, color: selected.color || '#99aab5', permissions: selected.permissions || [] });
    }
  }, [selectedId, roles]);

  const groupedCatalog = useMemo(() => {
    const groups = {};
    catalog.forEach(p => { (groups[p.group] ||= []).push(p); });
    return groups;
  }, [catalog]);

  const members = useMemo(
    () => (selected ? users.filter(u => u.roles?.some(r => r.id === selected.id)) : []),
    [users, selected]
  );
  const nonMembers = useMemo(
    () => (selected ? users.filter(u => u.status === 'approved' && !u.roles?.some(r => r.id === selected.id)) : []),
    [users, selected]
  );

  // ── 역할 생성/저장/삭제 ──
  const handleCreate = async () => {
    try {
      const res = await apiRequest('/roles', {
        method: 'POST',
        body: JSON.stringify({ name: '새 역할', color: '#99aab5', permissions: [] })
      });
      await load();
      setSelectedId(res.id);
      setPanel('display');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSave = async (customForm = null, isAuto = false) => {
    if (!selected) return;
    const payload = customForm || form;
    if (!String(payload.name || '').trim()) return;
    try {
      setSaving(true);
      setAutoSaveText('⏳ SQLite 저장 중...');
      await apiRequest(`/roles/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, auto_save: isAuto })
      });
      if (isAuto) {
        setRoles(prev =>
          prev.map(r =>
            r.id === selected.id
              ? { ...r, name: payload.name, color: payload.color, permissions: payload.permissions }
              : r
          )
        );
      } else {
        await load();
      }
      setAutoSaveText(`✅ 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
      onChanged?.();
    } catch (err) {
      if (!isAuto) alert(err.message);
      setAutoSaveText('⚠️ 저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const triggerRoleAutoSave = (nextForm) => {
    setForm(nextForm);
    if (!selected || !(canManage && selected.manageable)) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setAutoSaveText('⏳ 입력 감지 · 자동 저장 대기...');
    autoSaveTimerRef.current = setTimeout(() => {
      handleSave(nextForm, true);
    }, 500);
  };

  const handleTogglePermission = async (permKey, checked) => {
    const nextPerms = checked
      ? [...new Set([...form.permissions, permKey])]
      : form.permissions.filter(x => x !== permKey);
    const nextForm = { ...form, permissions: nextPerms };
    setForm(nextForm);
    // 권한 체크박스 변경 시 즉시 자동 저장하여 탭 이동 시 유실되지 않도록 처리
    await handleSave(nextForm, false);
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`'${selected.name}' 역할을 삭제할까요?\n이 역할을 가진 멤버 ${selected.member_count}명에게서 역할이 제거됩니다.`)) return;
    try {
      await apiRequest(`/roles/${selected.id}`, { method: 'DELETE' });
      await load(false);
      onChanged?.();
    } catch (err) {
      alert(err.message);
    }
  };

  // ── 순서 변경 (변경 즉시 SQLite 자동 저장) ──
  const saveOrderImmediately = async (nextOrder) => {
    setOrder(nextOrder);
    try {
      setAutoSaveText('⏳ 역할 순서 SQLite 저장 중...');
      await apiRequest('/roles/order', { method: 'PUT', body: JSON.stringify({ order: nextOrder }) });
      await load();
      setAutoSaveText(`✅ 순서 자동 저장됨 (${new Date().toLocaleTimeString('ko-KR', { hour12: false })})`);
      onChanged?.();
    } catch (err) {
      alert(err.message);
      setOrder(roles.map(r => r.id));
    }
  };

  const moveRole = (id, delta) => {
    const idx = order.indexOf(id);
    const next = idx + delta;
    if (next < 0 || next >= order.length) return;
    const copy = [...order];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    saveOrderImmediately(copy);
  };

  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) return;
    const copy = order.filter(id => id !== dragId);
    copy.splice(copy.indexOf(targetId), 0, dragId);
    setDragId(null);
    saveOrderImmediately(copy);
  };

  const handleSaveOrder = async () => {
    await saveOrderImmediately(order);
  };

  // ── 멤버 ──
  const setUserRoles = async (target, roleIds) => {
    try {
      // 멤버 변경 전에 현재 역할 이름/색상/권한 변경사항이 있다면 먼저 저장
      if (selected && editable && (form.name !== selected.name || form.color !== selected.color)) {
        await apiRequest(`/roles/${selected.id}`, { method: 'PUT', body: JSON.stringify(form) });
      }
      await apiRequest(`/users/${target.id}/roles`, { method: 'PUT', body: JSON.stringify({ role_ids: roleIds }) });
      await load();
      onChanged?.();
    } catch (err) {
      alert(err.message);
    }
  };

  const addMember = () => {
    const target = users.find(u => String(u.id) === memberToAdd);
    if (!target || !selected) return;
    setUserRoles(target, [...(target.roles || []).map(r => r.id), selected.id]);
    setMemberToAdd('');
  };

  const removeMember = (target) => {
    setUserRoles(target, (target.roles || []).map(r => r.id).filter(id => id !== selected.id));
  };

  const editable = canManage && selected?.manageable;
  const canGrant = (perm) => user.is_admin || user.permissions?.includes(perm);

  return (
    <div className="card" style={{ marginBottom: 28 }}>
      <div className="card-header">
        <div className="card-title">
          <Shield size={20} color="#5865f2" />
          <span>역할 관리</span>
          <span className="badge badge-approved" style={{ marginLeft: 8, fontSize: 11 }}>
            {autoSaveText}
          </span>
        </div>
        {canManage && (
          <button className="btn btn-primary btn-sm" onClick={handleCreate}>
            <Plus size={14} /> 역할 만들기
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
        디스코드처럼 역할을 만들고, 역할마다 권한을 켜고, 순서를 정할 수 있어요. 위에 있는 역할일수록 높은 역할이며,
        <strong> 자신의 가장 높은 역할보다 아래 있는 역할만</strong> 수정하거나 다른 사람에게 줄 수 있어요. 한 사람이 여러 역할을 가지면 권한이 모두 합쳐집니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, minHeight: 360 }}>
        {/* 왼쪽: 역할 목록 */}
        <div style={{ borderRight: '1px solid var(--border-color)', paddingRight: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
            역할 — {roles.length}개 (위가 높음)
          </div>
          {order.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>아직 역할이 없어요. 역할을 만들어 보세요.</div>
          )}
          {order.map((id, idx) => {
            const r = roleById[id];
            if (!r) return null;
            const draggable = canManage && r.manageable;
            return (
              <div
                key={id}
                draggable={draggable}
                onDragStart={() => setDragId(id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(id)}
                onClick={() => setSelectedId(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
                  marginBottom: 2,
                  background: selectedId === id ? 'var(--bg-tertiary)' : 'transparent',
                  opacity: dragId === id ? 0.4 : 1
                }}
              >
                {draggable ? <GripVertical size={14} color="var(--text-muted)" style={{ cursor: 'grab' }} /> : <Lock size={12} color="var(--text-muted)" />}
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.member_count}</span>
                {draggable && (
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveRole(id, -1); }} disabled={idx === 0}
                      style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }} title="위로">
                      <ChevronUp size={13} />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveRole(id, 1); }} disabled={idx === order.length - 1}
                      style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', lineHeight: 0 }} title="아래로">
                      <ChevronDown size={13} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          {orderDirty && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleSaveOrder}>
                <Save size={13} /> 순서 저장
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setOrder(roles.map(r => r.id))}>취소</button>
            </div>
          )}
        </div>

        {/* 오른쪽: 역할 편집 */}
        <div>
          {!selected ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>왼쪽에서 역할을 선택하세요.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: form.color }}>역할 편집 — {selected.name}</div>
                {!editable && (
                  <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                    <Lock size={11} /> 내 역할보다 높거나 같아서 읽기 전용
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
                {[['display', '표시'], ['permissions', `권한 (${form.permissions.length})`], ['members', `멤버 (${members.length})`]].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setPanel(key)}
                    style={{
                      border: 'none', background: 'none', padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      color: panel === key ? 'var(--primary)' : 'var(--text-secondary)',
                      borderBottom: panel === key ? '2px solid var(--primary)' : '2px solid transparent'
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              {panel === 'display' && (
                <div>
                  <div className="form-group">
                    <label className="form-label">역할 이름 (입력 시 자동 저장)</label>
                    <input className="input" value={form.name} disabled={!editable}
                      onChange={(e) => triggerRoleAutoSave({ ...form, name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">역할 색상 (선택 시 자동 저장)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {PRESET_COLORS.map(c => (
                        <button key={c} type="button" disabled={!editable} onClick={() => triggerRoleAutoSave({ ...form, color: c })}
                          style={{
                            width: 28, height: 28, borderRadius: 6, background: c, cursor: editable ? 'pointer' : 'default',
                            border: form.color === c ? '3px solid var(--text-main)' : '1px solid var(--border-color)'
                          }} />
                      ))}
                      <input type="color" value={form.color} disabled={!editable}
                        onChange={(e) => triggerRoleAutoSave({ ...form, color: e.target.value })}
                        style={{ width: 36, height: 30, padding: 0, border: 'none', background: 'none' }} />
                    </div>
                  </div>
                </div>
              )}

              {panel === 'permissions' && (
                <div>
                  {Object.entries(groupedCatalog).map(([group, perms]) => (
                    <div key={group} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 6 }}>{group}</div>
                      {perms.map(p => {
                        const on = form.permissions.includes(p.key);
                        const disabled = !editable || !canGrant(p.key);
                        return (
                          <label key={p.key} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                            padding: '10px 0', borderBottom: '1px solid var(--border-color)', cursor: disabled ? 'default' : 'pointer',
                            opacity: disabled && !on ? 0.55 : 1
                          }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.key}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.description}</div>
                            </div>
                            <input type="checkbox" checked={on} disabled={disabled}
                              style={{ width: 18, height: 18 }}
                              onChange={(e) => handleTogglePermission(p.key, e.target.checked)} />
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {panel === 'members' && (
                <div>
                  {editable && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <select className="input" value={memberToAdd} onChange={(e) => setMemberToAdd(e.target.value)} style={{ flex: 1 }}>
                        <option value="">멤버 추가…</option>
                        {nonMembers.map(u => (
                          <option key={u.id} value={u.id}>{u.nickname || u.username} (@{u.username})</option>
                        ))}
                      </select>
                      <button className="btn btn-primary btn-sm" onClick={addMember} disabled={!memberToAdd}>
                        <Plus size={13} /> 추가
                      </button>
                    </div>
                  )}
                  {members.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}><Users size={14} /> 이 역할을 가진 멤버가 없어요.</div>
                  ) : members.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span style={{ fontWeight: 600 }}>{m.nickname || m.username} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{m.username}</span></span>
                      {editable && (
                        <button className="btn btn-secondary btn-sm" onClick={() => removeMember(m)} title="역할 제거">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {editable && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
                  <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                    <Trash2 size={13} /> 역할 삭제
                  </button>
                  <button className="btn btn-primary" onClick={() => handleSave()} disabled={saving}>
                    <Save size={14} /> {saving ? '저장 중…' : '변경사항 저장'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
