import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft, ArrowRight, Backpack, BookOpen, Check, ChevronRight, Compass, Copy, Crown,
  Diamond, DoorOpen, Flame, Flag, Gem, Hourglass, Info, Link, LoaderCircle, LockKeyhole,
  Mountain, Plus, Radio, RefreshCw, ShieldCheck, Skull, Sparkles, Tent, Trophy,
  Users, Volume2, VolumeX, WifiOff, X,
} from 'lucide-react';
import type { Card, GameMode, HazardType, PublicPlayer, PublicRoom, RoomAction, Session, SessionResponse, TrailEntry } from '../shared/types';
import { HAZARD_LABELS, MODE_LABELS } from '../shared/types';
import './styles.css';

const AVATAR_COLORS = ['#e7ae62', '#74bdad', '#b58bc6', '#da8176', '#83a6d4', '#b6c875', '#d392ad', '#bdad8e'];
const MODE_DESCRIPTIONS: Record<GameMode, string> = {
  classic: 'Чистый риск. Сокровища, опасности и пять экспедиций.',
  relics: 'Одна новая реликвия в каждой пещере. Забрать её может только одиночка.',
  legacy: 'Пять реликвий сразу в колоде. Первые три спасённые стоят 5, остальные — 10.',
};
const HAZARDS: HazardType[] = ['snake', 'scorpion', 'lava', 'boulder', 'spikes'];
const PROFILE_KEY = 'diamant.profile.v1';
const LAST_ROOM_KEY = 'diamant.last-room.v1';

function stored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* A private browser can disable persistence. */ }
}
function codeFromPath() { return window.location.pathname.match(/^\/room\/([A-Z0-9]{4,10})\/?$/i)?.[1]?.toUpperCase() ?? ''; }
function getSession(code: string): Session | null { return stored<Session | null>(`diamant.session.${code}`, null); }
function setSession(session: Session) { save(`diamant.session.${session.code}`, session); save(LAST_ROOM_KEY, session.code); }
function playerName(player?: PublicPlayer) { return player?.name ?? 'Исследователь'; }
function points(value: number) { return new Intl.NumberFormat('ru-RU').format(value); }

class APIError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
async function request<T>(path: string, options?: { method?: string; body?: unknown; token?: string; signal?: AbortSignal }): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options?.signal?.reason);
  if (options?.signal?.aborted) abortFromCaller();
  else options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
  try {
    const response = await fetch(path, { method: options?.method ?? 'GET', headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    }, body: options?.body ? JSON.stringify(options.body) : undefined, signal: controller.signal, cache: 'no-store' });
    const data = await response.json() as { error?: string; code?: string } & T;
    if (!response.ok) throw new APIError(data.error || 'Что-то пошло не так. Попробуйте ещё раз.', response.status, data.code);
    return data as T;
  } catch (error) {
    if (error instanceof APIError || options?.signal?.aborted) throw error;
    if (timedOut) throw new APIError('Лагерь долго не отвечает. Проверяем соединение — ваше место сохранено.', 0, 'REQUEST_TIMEOUT');
    if (error instanceof SyntaxError) throw new APIError('Не удалось прочитать ответ лагеря. Попробуйте ещё раз.', 502, 'INVALID_RESPONSE');
    throw new APIError('Не удалось связаться с лагерем. Проверьте соединение и попробуйте ещё раз.', 0, 'NETWORK_ERROR');
  } finally {
    window.clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function Avatar({ name, index = 0, size = 'normal', className = '' }: { name: string; index?: number; size?: 'small' | 'normal' | 'large'; className?: string }) {
  const colour = AVATAR_COLORS[Math.abs(index) % AVATAR_COLORS.length];
  return <span className={`avatar avatar-${size} ${className}`} style={{ '--avatar-color': colour } as React.CSSProperties} aria-label={name}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 58c2-15 9-21 20-21s19 6 21 21" fill="currentColor" opacity=".55"/><path d="M21 32c0 11 5 17 11 17s11-6 11-17V21H21Z" fill="#f7e8c7"/><path d="M17 26c-1-14 6-20 15-20s17 6 15 20l-5 6-2-14H24l-2 14Z" fill="#263b37"/><path d="M12 24h40l-5-7H17Z" fill="currentColor"/><path d="m21 17 3-9h16l4 9" fill="currentColor"/><path d="M27 32h1m9 0h1" stroke="#243931" strokeLinecap="round" strokeWidth="3"/><path d="M29 39q3 3 6 0" fill="none" stroke="#a9694d" strokeWidth="2" strokeLinecap="round"/><path d="m26 46 6 9 6-9" fill="#f7e8c7"/></svg>
  </span>;
}

function Brand({ onClick }: { onClick: () => void }) {
  return <button className="brand" onClick={onClick} aria-label="Diamant — на главную"><span className="brand-mark"><Gem size={30} strokeWidth={1.3}/></span><span>DIAMANT<span className="brand-sub">ONLINE EXPEDITION</span></span></button>;
}

function Rules({ mode, onClose }: { mode: GameMode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = dialog.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title" ref={dialog}>
    <button className="icon-button close-dialog" onClick={onClose} aria-label="Закрыть правила"><X/></button>
    <span className="eyebrow"><BookOpen size={15}/> Полевой справочник</span>
    <h2 id="rules-title">Знать, когда<br/><em>вернуться.</em></h2>
    <p className="rules-intro">Пять пещер. От 3 до 8 исследователей. Побеждает тот, кто сохранит больше всего драгоценностей.</p>
    <div className="rule-step"><span>01</span><div><h3>Двигайтесь вместе</h3><p>Новая карта открывается для всех, кто остался в пещере. Найденные сокровища делятся поровну. Остаток остаётся на тропе.</p></div></div>
    <div className="rule-step"><span>02</span><div><h3>Решайте тайно</h3><p>После каждой карты выберите: идти глубже или вернуться. Решения раскрываются только после выбора всех исследователей. Сделанный выбор изменить нельзя.</p></div></div>
    <div className="rule-step"><span>03</span><div><h3>Уносите вовремя</h3><p>Возвращающиеся забирают свою добычу и поровну делят все драгоценности, оставшиеся на тропе. Неделимый остаток остаётся в пещере. Содержимое сундука сохранено до конца игры.</p></div></div>
    <div className="rule-step"><span>04</span><div><h3>Вторая опасность — конец</h3><p>Две одинаковые опасности обрывают экспедицию. Все оставшиеся в пещере теряют добычу этого похода. Одна карта этой опасности навсегда убирается из колоды.</p></div></div>
    <div className="rules-relic"><Sparkles size={24}/><div><h3>{MODE_LABELS[mode]}</h3><p>{mode === 'classic' ? 'Базовая игра без реликвий: 15 карт сокровищ и 15 карт опасностей.' : mode === 'relics' ? 'В каждой экспедиции в колоду добавляется реликвия: 5, 7, 8, 10, затем 12 очков. Все открытые реликвии достаются тому, кто возвращается один. Не забранные открытые реликвии пропадают после экспедиции; не открытые остаются в колоде.' : 'Все пять реликвий находятся в колоде с начала игры. Первые три, которые игроки унесут из пещеры, стоят по 5 очков, две оставшиеся — по 10. Забрать открытые реликвии можно только возвращаясь одному.'}</p></div></div>
    <p className="rule-footnote">В этой комнате сундуки соперников закрыты до финала. При равном результате победа общая. Игра длится ровно пять экспедиций.</p>
    <div className="rules-links"><a href="https://hobbyworld.ru/download/rules/diamant-rules.pdf" target="_blank" rel="noreferrer">Правила Hobby World <ArrowRight size={14}/></a><a href="https://iellogames.com/jeux/diamant/" target="_blank" rel="noreferrer">Оригинальная игра IELLO <ArrowRight size={14}/></a></div>
    <button className="button primary full" onClick={onClose}>Всё ясно. В пещеру <ArrowRight size={18}/></button>
  </div></div>;
}

function ProfileForm({ name, setName, avatar, setAvatar }: { name: string; setName: (value: string) => void; avatar: number; setAvatar: (value: number) => void }) {
  return <><label className="field-label" htmlFor="explorer-name">Как вас зовут?</label><div className="name-field"><Avatar name={name || 'Ваш персонаж'} index={avatar} size="small"/><input id="explorer-name" placeholder="Имя исследователя" autoComplete="nickname" minLength={2} maxLength={20} value={name} onChange={e => setName(e.target.value)} required/></div><div className="avatar-picker" role="group" aria-label="Цвет персонажа">{AVATAR_COLORS.map((colour, index) => <button key={colour} type="button" onClick={() => setAvatar(index)} className={`avatar-option ${avatar === index ? 'selected' : ''}`} aria-pressed={avatar === index} aria-label={`Персонаж ${index + 1}`} style={{ '--avatar-color': colour } as React.CSSProperties}>{avatar === index && <Check size={12} strokeWidth={3}/>}</button>)}</div></>;
}

function Home({ onEnter, setError, busy, setBusy, resume }: { onEnter: (result: SessionResponse) => void; setError: (error: string) => void; busy: boolean; setBusy: (busy: boolean) => void; resume: (code: string) => void }) {
  const profile = stored(PROFILE_KEY, { name: '', avatar: 0 });
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<GameMode>('relics');
  const lastRoom = stored<string | null>(LAST_ROOM_KEY, null);
  const submit = async (practice = false) => {
    if (busy) return;
    if (name.trim().length < 2) { setError('Представьтесь команде: имя должно содержать от 2 до 20 символов.'); document.getElementById('explorer-name')?.focus(); return; }
    if (tab === 'join' && !practice && code.length < 4) { setError('Введите код комнаты из приглашения.'); return; }
    setBusy(true); setError('');
    try {
      save(PROFILE_KEY, { name: name.trim(), avatar });
      const oldSession = tab === 'join' && !practice ? getSession(code.toUpperCase()) : null;
      if (oldSession) { resume(code.toUpperCase()); return; }
      const result = await request<SessionResponse>(tab === 'join' && !practice ? `/api/rooms/${code.toUpperCase()}/join` : '/api/rooms', { method: 'POST', body: { name: name.trim(), avatar, mode, practice } });
      onEnter(result);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <main className="landing">
    <div className="landing-scene" aria-hidden="true"/>
    <div className="landing-content">
      <section className="landing-copy"><div className="eyebrow adventure-tag"><span className="tiny-line"/> НАСТОЛЬНОЕ ПРИКЛЮЧЕНИЕ. ТЕПЕРЬ ОНЛАЙН.</div><h1>Ещё один шаг.<br/><em>Или целое<br className="desktop-break"/> состояние.</em></h1><p>Пещера полна сокровищ. И причин вернуться.<br/>Испытайте удачу вместе с друзьями —<br/>но решение каждый принимает сам.</p><div className="landing-stats"><span><Users size={18}/><strong>3–8</strong> игроков</span><span><Hourglass size={18}/><strong>20</strong> минут</span><span><Mountain size={18}/><strong>5</strong> экспедиций</span></div><div className="field-note"><span>ЗАПИСКА № 01</span><p>«Самое трудное — не найти сокровище.<br/>Самое трудное — вовремя уйти».</p><Compass size={42} strokeWidth={1}/></div></section>
      <section className="expedition-pass" aria-labelledby="pass-title"><div className="pass-top"><Compass size={25} strokeWidth={1.4}/><span>ВАШ ПРОПУСК<br/><b>В НЕИЗВЕСТНОСТЬ</b></span><span className="pass-number">D / 05</span></div><div className="pass-body"><h2 id="pass-title">Соберём экспедицию?</h2><p className="pass-subtitle">Без регистрации. Только вы и ваша команда.</p><div className="form-tabs" role="tablist" aria-label="Войти в игру"><button role="tab" aria-selected={tab === 'create'} onClick={() => setTab('create')} className={tab === 'create' ? 'active' : ''}>Создать комнату</button><button role="tab" aria-selected={tab === 'join'} onClick={() => setTab('join')} className={tab === 'join' ? 'active' : ''}>По приглашению</button></div><form onSubmit={e => { e.preventDefault(); void submit(); }}><ProfileForm name={name} setName={setName} avatar={avatar} setAvatar={setAvatar}/>{tab === 'join' ? <div className="code-input-wrap"><label className="field-label" htmlFor="room-code">Код комнаты</label><input id="room-code" className="code-input" autoComplete="off" spellCheck="false" maxLength={10} placeholder="ABCDEF" value={code} onChange={e => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}/></div> : <div className="mode-field"><label className="field-label" htmlFor="game-mode">Вариант игры</label><select id="game-mode" value={mode} onChange={e => setMode(e.target.value as GameMode)}><option value="relics">С реликвиями · актуальные правила</option><option value="classic">Классика · без реликвий</option><option value="legacy">Редакция 2016 · старые реликвии</option></select><p>{MODE_DESCRIPTIONS[mode]}</p></div>}<button type="submit" className="button primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18}/> : <>{tab === 'create' ? 'Создать экспедицию' : 'Присоединиться'}<ArrowRight size={18}/></>}</button></form><button className="practice-button" disabled={busy} onClick={() => void submit(true)}><Compass size={16}/> Осмотреться с ботами <ChevronRight size={14}/></button>{lastRoom && getSession(lastRoom) && <button className="resume-button" onClick={() => resume(lastRoom)}><RefreshCw size={13}/> Вернуться в комнату {lastRoom}</button>}</div><div className="pass-bottom"><ShieldCheck size={14}/><span>Тайные решения. Настоящий азарт.</span></div></section>
    </div>
    <div className="landing-bottom"><span>ПО МОТИВАМ НАСТОЛЬНОЙ ИГРЫ DIAMANT</span><span>BRUNO FAIDUTTI & ALAN R. MOON</span><span>Смелость — это выбор.</span></div>
  </main>;
}

function Invite({ code, compact = false }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/room/${code}`); setCopied(true); setCopyError(false); window.setTimeout(() => setCopied(false), 2500); }
    catch { setCopyError(true); }
  };
  return <div className={compact ? 'invite-compact' : 'invite-ticket'}><div><span className="eyebrow">КОД ЭКСПЕДИЦИИ</span><strong>{code}</strong></div><button className={compact ? 'icon-button' : 'button secondary'} onClick={() => void copy()} aria-label="Скопировать приглашение">{copied ? <Check size={17}/> : <Copy size={17}/>}<span>{copied ? 'Ссылка скопирована' : 'Пригласить друзей'}</span></button>{copyError && <input aria-label="Ссылка для приглашения" className="copy-fallback" readOnly value={`${location.origin}/room/${code}`} onFocus={e => e.target.select()}/>}</div>;
}

function JoinRoom({ room, onEnter, busy, setBusy, setError }: { room: PublicRoom; onEnter: (result: SessionResponse) => void; busy: boolean; setBusy: (busy: boolean) => void; setError: (error: string) => void }) {
  const profile = stored(PROFILE_KEY, { name: '', avatar: 0 });
  const [name, setName] = useState(profile.name); const [avatar, setAvatar] = useState(profile.avatar);
  const join = async (event: React.FormEvent) => { event.preventDefault(); if (busy || name.trim().length < 2) return; setBusy(true); setError(''); try { save(PROFILE_KEY, { name: name.trim(), avatar }); onEnter(await request<SessionResponse>(`/api/rooms/${room.code}/join`, { method: 'POST', body: { name: name.trim(), avatar } })); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  if (room.phase !== 'lobby') return <div className="spectator-notice"><Radio size={17}/><span>Вы наблюдаете за экспедицией. Присоединиться можно перед началом следующей игры.</span></div>;
  return <form className="join-panel" onSubmit={e => void join(e)}><span className="eyebrow">МЕСТО ДЛЯ ВАС</span><h3>Команда ждёт.</h3><ProfileForm name={name} setName={setName} avatar={avatar} setAvatar={setAvatar}/><button className="button primary full" disabled={busy || room.players.length >= 8}>{busy ? <LoaderCircle size={18} className="spin"/> : room.players.length >= 8 ? 'Команда уже в сборе' : <>Занять место <ArrowRight size={17}/></>}</button></form>;
}

function Lobby({ room, busy, act, onEnter, setBusy, setError }: { room: PublicRoom; busy: boolean; act: (action: RoomAction) => void; onEnter: (result: SessionResponse) => void; setBusy: (busy: boolean) => void; setError: (error: string) => void }) {
  const me = room.players.find(p => p.id === room.youId); const host = room.hostId === room.youId;
  const readyPlayers = room.players.filter(p => p.ready).length;
  const allReady = room.players.length >= 3 && readyPlayers === room.players.length;
  return <main className="lobby page-shell"><div className="section-heading"><div><span className="eyebrow"><Flag size={14}/> БАЗОВЫЙ ЛАГЕРЬ</span><h1>В хорошей компании<br/><em>рисковать интереснее.</em></h1><p>Пригласите друзей, приготовьтесь — и отправляйтесь за сокровищами.</p></div><Invite code={room.code}/></div><div className="lobby-layout"><section className="crew-section"><div className="section-label"><h2>Ваша команда <span>{room.players.length} / 8</span></h2><span><span className="live-dot"/> Лобби открыто</span></div><div className="crew-grid">{room.players.map(player => <div className={`crew-card ${player.id === room.youId ? 'is-you' : ''}`} key={player.id}><div className="crew-card-top"><span>{player.id === room.youId ? 'ВЫ' : player.isBot ? 'БОТ' : 'ИССЛЕДОВАТЕЛЬ'}</span>{player.id === room.hostId ? <Crown size={16}/> : host && <button className="small-icon-button" aria-label={`Убрать ${player.name}`} disabled={busy} onClick={() => act({ type: 'removePlayer', playerId: player.id })}><X size={16}/></button>}</div><Avatar name={player.name} index={player.avatar} size="large"/><h3>{player.name}</h3><span className={`player-readiness ${player.ready ? 'ready' : ''}`}>{player.ready ? <><Check size={13}/> Готов к походу</> : <><Hourglass size={13}/> Собирает рюкзак</>}</span></div>)}{Array.from({ length: Math.max(0, (room.players.length <= 4 ? 4 : 8) - room.players.length) }, (_, i) => <div className="crew-card empty-slot" key={`empty-${i}`}><span className="seat-number">{String(room.players.length + i + 1).padStart(2, '0')}</span><div className="empty-avatar"><Users size={25} strokeWidth={1}/></div><span>Свободное место</span>{host && <button disabled={busy || room.players.length >= 8} onClick={() => act({ type: 'addBot' })}><Plus size={13}/> Добавить бота</button>}</div>)}</div><div className="lobby-tip"><Info size={17}/><p>Для экспедиции нужно хотя бы три исследователя. Боты помогут, если ваша команда пока меньше.</p></div>{me && <div className="launch-row"><span>{allReady ? 'Команда готова. Приключение начинается.' : room.players.length < 3 ? `Ждём ещё ${3 - room.players.length} ${room.players.length === 2 ? 'исследователя' : 'исследователей'}` : `Готовы ${readyPlayers} из ${room.players.length} исследователей`}</span>{host ? <div className="launch-buttons"><button className={`button ${me.ready ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => act({ type: 'ready', ready: !me.ready })}>{me.ready ? <><Check size={15}/> Готов</> : 'Я готов'}</button><button className="button primary" disabled={busy || !allReady} onClick={() => act({ type: 'start' })}>Начать экспедицию <ArrowRight size={18}/></button></div> : <button className={`button ${me.ready ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => act({ type: 'ready', ready: !me.ready })}>{me.ready ? <><Check size={17}/> Готов. Жду остальных</> : <>Я готов <ArrowRight size={17}/></>}</button>}</div>}</section><aside className="lobby-aside">{!me ? <JoinRoom room={room} onEnter={onEnter} busy={busy} setBusy={setBusy} setError={setError}/> : <div className="expedition-setting"><span className="eyebrow">МАРШРУТ ПРИКЛЮЧЕНИЯ</span><h3>Какая у нас история?</h3>{(['classic', 'relics', 'legacy'] as GameMode[]).map(mode => <button key={mode} className={`mode-option ${room.mode === mode ? 'active' : ''}`} onClick={() => act({ type: 'setMode', mode })} disabled={!host || busy} aria-pressed={room.mode === mode}><span className="mode-radio">{room.mode === mode && <span/>}</span><span><b>{MODE_LABELS[mode]}</b><small>{MODE_DESCRIPTIONS[mode]}</small></span></button>)}<div className="setting-meta"><span><Mountain size={15}/> 5 экспедиций</span><span><LockKeyhole size={15}/> Закрытые сундуки</span></div>{!host && <p className="muted small">Вариант игры выбирает организатор.</p>}</div>}<div className="lobby-illustration"><Gem size={35} strokeWidth={1}/><p>Удача любит смелых.<br/><em>Сундук — осторожных.</em></p><span>DIAMANT · ПОЛЕВОЙ ДНЕВНИК</span></div></aside></div></main>;
}

function HazardIcon({ type, size = 16 }: { type: HazardType; size?: number }) {
  if (type === 'lava') return <Flame size={size}/>;
  if (type === 'boulder') return <Mountain size={size}/>;
  if (type === 'spikes') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 20 4-14 4 14 3-17 4 17 3-12 2 12Z"/></svg>;
  if (type === 'snake') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 19h11a4 4 0 0 0 0-8H9a3 3 0 0 1 0-6h5m0 0 3-2m-3 2 3 2"/><path d="M4 19a2 2 0 0 1 0-4h9"/></svg>;
  return <Skull size={size}/>;
}

function ExpeditionCard({ entry, index, latest, small = false }: { entry: TrailEntry; index: number; latest?: boolean; small?: boolean }) {
  const { card } = entry;
  const art = card.kind === 'hazard' ? card.hazard : card.kind;
  const label = card.kind === 'treasure' ? 'Сокровище' : card.kind === 'relic' ? 'Реликвия' : HAZARD_LABELS[card.hazard];
  return <article className={`expedition-card card-${card.kind} ${latest ? 'latest-card' : ''} ${small ? 'small-card' : ''} ${entry.claimedBy ? 'claimed-card' : ''}`} aria-label={`${index + 1}. ${label}${card.kind !== 'hazard' ? `, ${card.value}` : ''}${entry.remaining ? `, на тропе осталось ${entry.remaining}` : ''}`}><div className="card-art-fallback" aria-hidden="true">{card.kind === 'hazard' ? <HazardIcon type={card.hazard} size={65}/> : card.kind === 'relic' ? <Sparkles size={65} strokeWidth={1}/> : <Gem size={65} strokeWidth={1}/>}</div><img className="card-art" src={`/art/cards/${art}.webp`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }}/><div className="card-shade"/><span className="card-index">{String(index + 1).padStart(2, '0')}</span><span className={`card-value ${card.kind === 'relic' && !card.value ? 'legacy-relic-value' : ''}`}>{card.kind === 'hazard' ? <HazardIcon type={card.hazard} size={25}/> : card.value || '5 / 10'}</span><div className="card-caption"><span>{card.kind === 'hazard' ? 'ОПАСНОСТЬ' : card.kind === 'relic' ? 'ДРЕВНЯЯ НАХОДКА' : 'ДРАГОЦЕННОСТИ'}</span><strong>{label}</strong></div>{card.kind === 'treasure' && entry.remaining > 0 && <div className="card-remainder"><Gem size={12}/>{entry.remaining} на тропе</div>}{entry.claimedBy && <div className="claimed-badge"><Check size={12}/> Забрана</div>}</article>;
}

function PlayerStrip({ room }: { room: PublicRoom }) {
  return <div className="players-strip" aria-label="Исследователи">{room.players.map(player => <div key={player.id} className={`board-player ${player.id === room.youId ? 'is-you' : ''} ${player.status !== 'exploring' ? 'not-exploring' : ''}`}><div className="player-avatar-wrap"><Avatar name={player.name} index={player.avatar}/>{player.status === 'camp' ? <span className="player-status-dot camp"><Tent size={11}/></span> : player.status === 'lost' ? <span className="player-status-dot lost"><X size={12}/></span> : room.decidedIds.includes(player.id) && <span className="player-status-dot chosen"><Check size={12}/></span>}</div><div className="board-player-info"><strong>{player.name}{player.id === room.youId && <span>ВЫ</span>}</strong><small>{player.status === 'camp' ? 'В лагере' : player.status === 'lost' ? 'Без добычи' : room.decidedIds.includes(player.id) ? 'Решение принято' : 'Исследует пещеру'}</small></div><div className="board-player-loot"><Gem size={13}/><b>{player.loot}</b><span className="sr-only">в рюкзаке</span></div></div>)}</div>;
}

function RoundSummary({ room, busy, act }: { room: PublicRoom; busy: boolean; act: (action: RoomAction) => void }) {
  const result = room.roundResult;
  return <div className={`round-summary ${result?.reason === 'hazard' ? 'danger-summary' : ''}`} role="status"><div className="round-summary-icon">{result?.reason === 'hazard' ? <Skull size={26}/> : <Tent size={26}/>}</div><div><span className="eyebrow">ЭКСПЕДИЦИЯ {room.round} ЗАВЕРШЕНА</span><h2>{result?.reason === 'hazard' ? 'Пещера забрала своё.' : 'Все вернулись в лагерь.'}</h2><p>{result?.reason === 'hazard' ? `Снова ${result.hazard ? HAZARD_LABELS[result.hazard].toLocaleLowerCase('ru') : 'та же опасность'}. Добыча оставшихся в пещере потеряна.` : 'Время перевести дух. В следующей пещере вас ждёт новая история.'}</p><div className="round-gains">{room.players.map(p => <span key={p.id}><i style={{ background: AVATAR_COLORS[p.avatar % AVATAR_COLORS.length] }}/>{p.name}<b>{result?.lost[p.id] ? `−${result.lost[p.id]} потеряно` : `+${result?.gains[p.id] ?? 0} в сундук`}</b></span>)}</div></div>{room.youId ? <button className="button primary" disabled={busy} onClick={() => act({ type: 'nextRound' })}>В следующую пещеру <ArrowRight size={17}/></button> : <span className="waiting-host"><Hourglass size={16}/> Команда скоро начнёт следующий поход</span>}</div>;
}

function GameTable({ room, busy, act }: { room: PublicRoom; busy: boolean; act: (action: RoomAction) => void }) {
  const me = room.players.find(p => p.id === room.youId);
  const trailRef = useRef<HTMLDivElement>(null);
  const trailTotal = room.trail.reduce((sum, item) => sum + item.remaining, 0);
  const active = room.players.filter(p => p.status === 'exploring');
  const canChoose = room.phase === 'decision' && me?.status === 'exploring' && !room.currentDecision;
  const outstanding = active.filter(p => !room.decidedIds.includes(p.id));
  const relicCount = room.trail.filter(entry => entry.card.kind === 'relic' && !entry.claimedBy).length;
  useEffect(() => { trailRef.current?.scrollTo({ left: trailRef.current.scrollWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [room.trail.length, room.round]);
  return <main className="game page-shell"><div className="game-title-row"><div><span className="eyebrow"><Compass size={14}/> {MODE_LABELS[room.mode]} <span className="label-divider">/</span> КОМНАТА {room.code}</span><h1>Вглубь <em>неизвестности.</em></h1></div><div className="round-progress" aria-label={`Экспедиция ${room.round} из 5`}>{[1,2,3,4,5].map(n => <div key={n} className={`${n === room.round ? 'current' : n < room.round ? 'complete' : ''}`}><span>{n < room.round ? <Check size={13}/> : n}</span><small>{n === room.round ? 'ВЫ ЗДЕСЬ' : n < room.round ? 'ПРОЙДЕНО' : 'ПЕЩЕРА'}</small></div>)}</div></div><PlayerStrip room={room}/><div className="table-layout"><section className="cave-table"><div className="table-toolbar"><span><span className="live-dot"/> ЭКСПЕДИЦИЯ {room.round} <span className="label-divider">/</span> ШАГ {room.turn}</span><span><LayersIcon/>{room.deckRemaining} карт в колоде</span></div><div className="hazard-watch"><span className="hazard-watch-label">Следы опасности</span>{HAZARDS.map(hazard => { const count = room.trail.filter(e => e.card.kind === 'hazard' && e.card.hazard === hazard).length; return <span key={hazard} className={`hazard-chip ${count ? 'seen' : ''} ${count > 1 ? 'fatal' : ''}`} title={`${HAZARD_LABELS[hazard]}: открыто ${count}. Вторая такая карта завершает экспедицию.`}><HazardIcon type={hazard}/><span>{HAZARD_LABELS[hazard]}</span><b>{count}</b></span>; })}</div><div className="trail-heading"><div><span className="eyebrow">ВАША ТРОПА</span><h2>{room.phase === 'roundEnd' ? 'На сегодня хватит.' : room.trail.length <= 1 ? 'Приключение начинается.' : 'Дальше — интереснее.'}</h2></div><div className="trail-treasure"><Gem size={19}/><div><strong>{trailTotal}</strong><span>на обратном пути</span></div></div></div><div className="trail-scroll" ref={trailRef}><div className="trail-camp"><Tent size={29} strokeWidth={1.3}/><span>ЛАГЕРЬ</span><span className="trail-line"/></div>{room.trail.map((entry, index) => <ExpeditionCard key={`${room.round}-${entry.card.id}`} entry={entry} index={index} latest={index === room.trail.length - 1}/>)}<div className="unrevealed-card"><div className="card-back-border"><Compass size={42} strokeWidth={1}/><span>НЕИЗВЕСТНОСТЬ</span></div></div></div><div className="table-footnote"><Info size={14}/><span>{room.phase === 'roundEnd' ? 'Эта тропа закрыта. Все оставшиеся драгоценности и открытые реликвии исчезают.' : relicCount > 0 ? `На тропе есть реликвии. Вернитесь в одиночку, чтобы забрать их.` : 'Две одинаковые опасности — и всё найденное в этом походе потеряно.'}</span></div></section><aside className="expedition-log"><div className="section-label"><h2>Полевой дневник</h2><BookOpen size={16}/></div><div className="log-entries" aria-label="События экспедиции">{room.events.slice(-14).reverse().map(event => <div className={`log-entry log-${event.kind}`} key={event.id}><span className="log-event-icon">{event.kind === 'treasure' ? <Gem size={14}/> : event.kind === 'hazard' ? <Skull size={14}/> : event.kind === 'return' ? <Tent size={14}/> : event.kind === 'relic' ? <Sparkles size={14}/> : <Compass size={14}/>}</span><div><p>{event.text}</p><small>ПЕЩЕРА {event.round} · ШАГ {event.turn}</small></div></div>)}</div><div className="retired-hazards"><span>Убрано из колоды</span><div>{room.retiredHazards.length ? room.retiredHazards.map((hazard, index) => <span key={`${hazard}-${index}`} title={HAZARD_LABELS[hazard]}><HazardIcon type={hazard}/></span>) : <small>Пока ни одной опасности</small>}</div></div></aside></div>{room.phase === 'roundEnd' && <RoundSummary room={room} busy={busy} act={act}/>}{room.phase === 'decision' && <section className="decision-bar" aria-label="Ваше решение"><div className="your-treasure"><div><span className="treasure-icon"><Backpack size={22}/></span><div><span className="eyebrow">В РЮКЗАКЕ</span><strong>{me ? points(me.loot) : '—'}<Gem size={16}/></strong><small>под риском</small></div></div><div><span className="treasure-icon safe"><ShieldCheck size={22}/></span><div><span className="eyebrow">В СУНДУКЕ</span><strong>{me?.score != null ? points(me.score) : '—'}<Gem size={16}/></strong><small>уже сохранено</small></div></div></div><div className="decision-content">{!me ? <div className="decision-message"><Radio size={21}/><div><strong>Наблюдаете за экспедицией</strong><span>Участники принимают решения.</span></div></div> : me.status !== 'exploring' ? <div className="decision-message"><Tent size={25}/><div><strong>{me.status === 'camp' ? 'Вы в безопасности.' : 'Следующая пещера — новый шанс.'}</strong><span>{me.status === 'camp' ? 'Наблюдайте, как далеко зайдут остальные.' : 'Ваша добыча этого похода потеряна.'}</span></div></div> : room.currentDecision ? <div className="decision-message chosen-message"><LockKeyhole size={23}/><div><strong>{room.currentDecision === 'return' ? 'Вы возвращаетесь в лагерь.' : 'Вы идёте дальше.'}</strong><span>Выбор скрыт. Ждём {outstanding.length ? outstanding.map(p => p.name).join(', ') : 'раскрытия решений'}.</span></div><span className="decision-counter">{room.decidedIds.length}/{active.length}</span></div> : <><div className="decision-prompt"><strong>Рискнёте ещё раз?</strong><span>Решения раскроются одновременно <span>{room.decidedIds.length}/{active.length}</span></span></div><div className="decision-buttons"><button className="button return-button" disabled={busy || !canChoose} onClick={() => act({ type: 'choose', choice: 'return', round: room.round, turn: room.turn })}><Tent size={18}/> В лагерь</button><button className="button primary" disabled={busy || !canChoose} onClick={() => act({ type: 'choose', choice: 'continue', round: room.round, turn: room.turn })}>Идти глубже <ArrowRight size={18}/></button></div></>}</div></section>}</main>;
}

function LayersIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>; }

function Finished({ room, act, busy, onHome }: { room: PublicRoom; act: (action: RoomAction) => void; busy: boolean; onHome: () => void }) {
  const ranking = [...room.players].sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
  const winners = ranking.filter(p => room.winners.includes(p.id));
  const won = room.youId && room.winners.includes(room.youId);
  return <main className="finish page-shell"><div className="finish-glow"/><span className="finish-medallion"><Trophy size={43} strokeWidth={1.2}/></span><span className="eyebrow">ПЯТЬ ПЕЩЕР. ОДНА ИСТОРИЯ.</span><h1>{won ? <>Это была <em>ваша экспедиция.</em></> : <>Сокровища нашли <em>своих героев.</em></>}</h1><p>{winners.length > 1 ? `${winners.map(playerName).join(' и ')} делят победу.` : `${playerName(winners[0])} возвращается с самым ценным сундуком.`}</p><div className="winners-portraits">{winners.map(player => <div key={player.id}><Crown size={24}/><Avatar name={player.name} index={player.avatar} size="large"/><strong>{player.name}</strong><span><Gem size={17}/>{player.score} очков</span></div>)}</div><div className="ranking"><div className="ranking-header"><span>ИССЛЕДОВАТЕЛЬ</span><span>СОКРОВИЩА</span><span>РЕЛИКВИИ</span><span>ИТОГО</span></div>{ranking.map((player, index) => <div key={player.id} className={`ranking-row ${room.winners.includes(player.id) ? 'winner-row' : ''}`}><div><span className="rank-number">{room.winners.includes(player.id) ? <Crown size={16}/> : String(index + 1).padStart(2, '0')}</span><Avatar name={player.name} index={player.avatar} size="small"/><strong>{player.name}{player.id === room.youId && <small>ВЫ</small>}</strong></div><span>{player.bank ?? 0}</span><span>{player.relics.reduce((sum, card) => sum + card.value, 0)}<small>{player.relics.length} шт.</small></span><b>{player.score ?? 0}</b></div>)}</div><div className="finish-actions">{room.youId === room.hostId ? <button className="button primary" disabled={busy} onClick={() => act({ type: 'rematch' })}><RefreshCw size={17}/> Ещё одно приключение</button> : <span className="muted">Организатор может начать новую игру в этой комнате.</span>}<button className="button secondary" onClick={onHome}><ArrowLeft size={17}/> На главную</button></div><p className="finish-note">Та же команда. Новая история. Удача ещё может улыбнуться.</p></main>;
}

function App() {
  const [code, setCode] = useState(codeFromPath);
  const [session, updateSession] = useState<Session | null>(() => getSession(codeFromPath()));
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [loading, setLoading] = useState(!!code);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [roomMissing, setRoomMissing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const generation = useRef(0);
  const currentRoom = useRef<PublicRoom | null>(null);
  const setSnapshot = useCallback((snapshot: PublicRoom) => {
    setRoom(previous => {
      if (previous?.code === snapshot.code && previous.version > snapshot.version) return previous;
      currentRoom.current = snapshot; return snapshot;
    });
  }, []);
  const navigate = useCallback((nextCode: string) => {
    generation.current++;
    window.history.pushState({}, '', nextCode ? `/room/${nextCode}` : '/');
    setCode(nextCode); updateSession(nextCode ? getSession(nextCode) : null); setRoom(null); currentRoom.current = null;
    setError(''); setOffline(false); setLoading(!!nextCode); setRoomMissing(false); setConfirmExit(false); window.scrollTo({ top: 0 });
  }, []);
  const onEnter = (result: SessionResponse) => {
    const next = { code: result.code, token: result.token, playerId: result.playerId };
    setSession(next); updateSession(next); setCode(result.code); setSnapshot(result.room); setLoading(false); setRoomMissing(false); setError('');
    window.history.pushState({}, '', `/room/${result.code}`); window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const pop = () => { generation.current++; const nextCode = codeFromPath(); setCode(nextCode); updateSession(getSession(nextCode)); setRoom(null); currentRoom.current = null; setLoading(!!nextCode); setError(''); setRoomMissing(false); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!code) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let errors = 0; let inFlight = false;
    const controller = new AbortController(); const requestGeneration = ++generation.current;
    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const result = await request<{ room: PublicRoom }>(`/api/rooms/${code}`, { token: session?.code === code ? session.token : undefined, signal: controller.signal });
        if (stopped || requestGeneration !== generation.current) return;
        setSnapshot(result.room); setLoading(false); setOffline(false); setRoomMissing(false); errors = 0;
      } catch (cause) {
        if (stopped || requestGeneration !== generation.current) return;
        const issue = cause as APIError;
        if (issue.status === 404 || issue.status === 410) { setRoomMissing(true); setLoading(false); setError(issue.message); return; }
        if (issue.status === 401 || issue.status === 403) { try { localStorage.removeItem(`diamant.session.${code}`); } catch { /* Storage can be disabled. */ } updateSession(null); setError('Ваше место больше недоступно. Можно присоединиться снова, пока открыто лобби.'); return; }
        errors++; setOffline(true); if (!currentRoom.current) { setLoading(false); setError(issue.message); }
      } finally { inFlight = false; }
      if (!stopped) timer = setTimeout(() => void poll(), document.hidden ? 5000 : Math.min(1000 * Math.max(1, errors), 8000));
    };
    void poll();
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, [code, session?.token, setSnapshot]);
  const act = async (action: RoomAction) => {
    if (!session || busy) return;
    const actionCode = code; const token = session.token;
    const requestId = crypto.randomUUID();
    let retried = false;
    const send = () => request<{ room: PublicRoom }>(`/api/rooms/${actionCode}/action`, { method: 'POST', token, body: { action, requestId } });
    const completeDeparture = () => {
      try {
        localStorage.removeItem(`diamant.session.${actionCode}`);
        if (stored(LAST_ROOM_KEY, null) === actionCode) localStorage.removeItem(LAST_ROOM_KEY);
      } catch { /* Storage can be disabled. */ }
      if (codeFromPath() === actionCode) navigate('');
    };
    setBusy(true); setError('');
    try {
      let result: { room: PublicRoom };
      try { result = await send(); }
      catch (cause) {
        if (!(cause instanceof APIError) || cause.status !== 0) throw cause;
        retried = true;
        result = await send();
      }
      if (action.type === 'leave') completeDeparture();
      else if (codeFromPath() === actionCode) setSnapshot(result.room);
    } catch (cause) {
      // A successful first leave revokes the token before its lost response can be retried.
      if (action.type === 'leave' && retried && cause instanceof APIError && cause.status === 401) completeDeparture();
      else if (codeFromPath() === actionCode) setError((cause as Error).message);
    } finally { setBusy(false); }
  };
  const home = () => { if (room?.phase === 'decision' && room.players.find(p => p.id === room.youId)?.status === 'exploring') setConfirmExit(true); else navigate(''); };
  const closeRules = useCallback(() => setShowRules(false), []);
  return <div className={`app ${code ? 'in-room' : 'at-home'}`}><a className="skip-link" href="#main-content">Перейти к игре</a><header className="site-header"><Brand onClick={home}/><nav aria-label="Основная навигация">{room && <span className="header-room"><span className="live-dot"/>{room.code}</span>}<button className="header-link" onClick={() => setShowRules(true)}><BookOpen size={17}/><span>Как играть</span></button>{room?.youId && room.phase === 'lobby' && <button className="icon-button exit-lobby" aria-label="Покинуть лобби" disabled={busy} onClick={() => void act({ type: 'leave' })}><DoorOpen size={18}/></button>}</nav></header><div id="main-content" tabIndex={-1}>{offline && <div className="connection-banner" role="status"><WifiOff size={16}/> Связь с лагерем прервалась. Восстанавливаем соединение; партия сохранена.</div>}{error && <div className="error-toast" role="alert"><Info size={18}/><span>{error}</span><button aria-label="Закрыть сообщение" onClick={() => setError('')}><X size={17}/></button></div>}{!code ? <Home onEnter={onEnter} setError={setError} busy={busy} setBusy={setBusy} resume={navigate}/> : loading ? <main className="loading-screen"><Compass size={44} strokeWidth={1}/><h1>Ищем базовый лагерь</h1><p>Экспедиция {code}</p><LoaderCircle size={22} className="spin"/></main> : roomMissing || !room ? <main className="loading-screen"><Mountain size={50} strokeWidth={1}/><h1>{roomMissing ? 'Тропа затерялась.' : 'Лагерь пока вне связи.'}</h1><p>{roomMissing ? 'Проверьте код приглашения или начните новую экспедицию.' : 'Проверьте интернет. Мы продолжаем искать вашу комнату.'}</p><button className="button primary" onClick={() => navigate('')}><ArrowLeft size={17}/> К новой истории</button></main> : room.phase === 'lobby' ? <Lobby room={room} busy={busy} act={action => void act(action)} onEnter={onEnter} setBusy={setBusy} setError={setError}/> : room.phase === 'finished' ? <Finished room={room} busy={busy} act={action => void act(action)} onHome={() => navigate('')}/> : <GameTable room={room} busy={busy} act={action => void act(action)}/>}</div>{code && <footer className="game-footer"><span>DIAMANT ONLINE</span><span>Оригинальная игра: Bruno Faidutti & Alan R. Moon · IELLO</span><button onClick={() => setShowRules(true)}>Правила и редакции <ArrowRight size={12}/></button></footer>}{showRules && <Rules mode={room?.mode ?? 'relics'} onClose={closeRules}/>} {confirmExit && <div className="modal-backdrop"><section className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title"><Compass size={30}/><h2 id="exit-title">Вы ещё в пещере.</h2><p>Остальные ждут вашего решения. Можно сначала сделать выбор или вернуться в эту комнату позже с того же устройства.</p><div><button className="button primary" onClick={() => setConfirmExit(false)}>Остаться в игре</button><button className="button secondary" onClick={() => navigate('')}>На главную</button></div></section></div>}</div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
