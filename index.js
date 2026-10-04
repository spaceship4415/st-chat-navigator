// 채팅 내비게이터: 마법봉 메뉴 하나로 현재 채팅 검색, 번호로 이동, 책갈피, 이 채팅 정보(페르소나·작가 노트·덮어쓰기·로어북), 범위 숨기기·삭제, 골라서 숨기기·삭제, 맨 위/아래(떠 있는 버튼도), 답변 처음부터 읽기, 읽던 위치 이어 보기, 현재 위치 표시.
// 덤으로 N턴마다 / N토큰마다 알림을 띄운다.

const MODULE = 'chat-navigator';
const META_KEY = 'chat_navigator';
const PAGE_SIZE = 100;
const FAR_JUMP = 300;
const KEEP_RECENT = 20;

const ctx = () => SillyTavern.getContext();

function getSettings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    const s = all[MODULE];
    s.turnAlert ??= false;
    s.turnEvery ??= 20;
    s.tokenAlert ??= false;
    s.tokenEvery ??= 10000;
    s.floatTop ??= false;
    s.floatBottom ??= false;
    s.readFromTop ??= false;
    s.resumePos ??= false;
    s.showPos ??= false;
    return s;
}

function hasChat() {
    if (ctx().getCurrentChatId?.()) return true;
    toastr.warning('열린 채팅이 없습니다.');
    return false;
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 지금 화면에 그려진 가장 앞 메시지 번호 */
function firstRenderedIndex() {
    const id = Number(document.querySelector('#chat .mes')?.getAttribute('mesid'));
    return Number.isFinite(id) ? id : 0;
}

/**
 * 멀리 있는 메시지로 가면 그 사이 메시지를 전부 그려야 해서 폰에서 오래 멈출 수 있다.
 * FAR_JUMP개 넘게 불러와야 하면 먼저 묻는다. 진행하면 true.
 */
async function confirmFarJump(index) {
    const toLoad = firstRenderedIndex() - index;
    if (toLoad <= FAR_JUMP) return true;
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    const result = await callGenericPopup(
        `<span class="chatnav_popup">#${index}까지 가려면 메시지 ${toLoad.toLocaleString()}개를 불러와야 합니다.<br>기기에 따라 잠시 멈출 수 있습니다. 계속할까요?</span>`,
        POPUP_TYPE.CONFIRM, '', { okButton: '불러오기', cancelButton: '취소' },
    );
    return result === POPUP_RESULT.AFFIRMATIVE;
}

// 이전 메시지 불러오기·하이라이트는 /chat-jump에 맡긴다.
// 다만 smooth 스크롤이 무시되는 환경이 있어서, 도착하지 못했으면 바로 옮겨 준다.
async function jumpTo(index) {
    await ctx().executeSlashCommandsWithOptions(`/chat-jump ${index}`);
    await new Promise(resolve => setTimeout(resolve, 700));

    const container = document.getElementById('chat');
    const element = container?.querySelector(`.mes[mesid="${index}"]`);
    if (!container || !element) return;
    const target = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const reachable = Math.min(target, container.scrollHeight - container.clientHeight);
    if (Math.abs(container.scrollTop - reachable) > 20) {
        container.scrollTop = target;
    }
}

/** 목록에서 메시지를 고르면: 멀리면 묻고, 팝업을 닫고, 이동. 연타는 무시. */
function makePicker(popup) {
    let busy = false;
    return async (index) => {
        if (busy) return;
        busy = true;
        try {
            // 묻는 창을 목록 위에 띄워서, 취소하면 목록이 그대로 남게
            if (!await confirmFarJump(index)) return;
            await popup.completeCancelled();
            await jumpTo(index);
        } finally {
            busy = false;
        }
    };
}

// ---------- 메시지 번호로 이동 ----------

async function openJumpPopup() {
    if (!hasChat()) return;
    const { chat, callGenericPopup, POPUP_TYPE } = ctx();
    const last = chat.length - 1;
    const value = await callGenericPopup(`<span class="chatnav_popup">이동할 메시지 번호 (0 ~ ${last})</span>`, POPUP_TYPE.INPUT, '', {
        okButton: '이동',
        cancelButton: '취소',
    });
    if (value === null || value === false || String(value).trim() === '') return;

    const index = Number(String(value).trim().replace(/^#/, ''));
    if (!Number.isInteger(index) || index < 0 || index > last) {
        toastr.warning(`0 ~ ${last} 사이의 번호를 입력하세요.`);
        return;
    }
    if (!await confirmFarJump(index)) return;
    await jumpTo(index);
}

// ---------- 채팅 검색 ----------

/** 메시지별 소문자 텍스트 캐시. 메시지가 수정되면 원문이 달라지므로 다시 만든다. */
const lowerCache = new WeakMap();

function lowerText(message) {
    const text = String(message?.mes ?? '');
    const cached = lowerCache.get(message);
    if (cached?.text === text) return cached.lower;
    const lower = text.toLowerCase();
    if (message && typeof message === 'object') lowerCache.set(message, { text, lower });
    return lower;
}

/** 찾은 메시지 번호를 최근 순으로 전부 돌려준다. 그리는 건 페이지 단위로. */
function searchChat(query) {
    const fragments = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const indices = [];
    if (!fragments.length) return { fragments, indices };

    const chat = ctx().chat;
    for (let i = chat.length - 1; i >= 0; i--) {
        const lower = lowerText(chat[i]);
        if (fragments.every(f => lower.includes(f))) indices.push(i);
    }
    return { fragments, indices };
}

function makeSnippet(text, fragments) {
    const flat = String(text ?? '').replace(/\s+/g, ' ');
    const lower = flat.toLowerCase();
    const pos = Math.max(0, lower.indexOf(fragments[0]));
    const start = Math.max(0, pos - 40);
    const end = Math.min(flat.length, pos + 120);
    let snippet = escapeHtml(flat.slice(start, end));
    const pattern = new RegExp(`(${fragments.map(f => escapeRegex(escapeHtml(f))).join('|')})`, 'gi');
    snippet = snippet.replace(pattern, '<mark>$1</mark>');
    return (start > 0 ? '…' : '') + snippet + (end < flat.length ? '…' : '');
}

async function openSearchPopup() {
    if (!hasChat()) return;
    const { Popup, POPUP_TYPE } = ctx();

    // 검색창은 고정, 결과 목록만 스크롤
    const root = document.createElement('div');
    root.className = 'chatnav_search';
    root.innerHTML = `
        <h3>채팅 검색</h3>
        <input type="search" class="text_pole chatnav_input" placeholder="검색어 (공백으로 여러 단어)" autocomplete="off">
        <div class="chatnav_status"></div>
        <div class="chatnav_results"></div>
    `;
    const input = root.querySelector('.chatnav_input');
    const status = root.querySelector('.chatnav_status');
    const list = root.querySelector('.chatnav_results');

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        leftAlign: true,
        onOpen: () => input.focus(),
    });

    let current = { fragments: [], indices: [] };
    let shown = 0;
    const updateStatus = () => {
        const total = current.indices.length;
        status.textContent = !current.fragments.length ? ''
            : total === 0 ? '찾은 메시지가 없습니다.'
                : shown < total ? `${total.toLocaleString()}개 찾음 · ${shown.toLocaleString()}개 표시 중`
                    : `${total.toLocaleString()}개 찾음`;
    };

    const onPick = makePicker(popup);

    const renderPage = () => {
        list.querySelector('.chatnav_more')?.remove();
        const chat = ctx().chat;
        const fragment = document.createDocumentFragment();
        for (const index of current.indices.slice(shown, shown + PAGE_SIZE)) {
            const message = chat[index];
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'chatnav_item';
            item.innerHTML = `
                <span class="chatnav_meta"><b>#${index}</b> ${escapeHtml(message?.name)}</span>
                <span class="chatnav_snippet">${makeSnippet(message?.mes, current.fragments)}</span>
            `;
            item.addEventListener('click', () => onPick(index));
            fragment.append(item);
        }
        shown = Math.min(current.indices.length, shown + PAGE_SIZE);

        const rest = current.indices.length - shown;
        if (rest > 0) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'menu_button chatnav_more';
            more.textContent = `더 보기 (${Math.min(rest, PAGE_SIZE)}개 더 · 남은 ${rest.toLocaleString()}개)`;
            more.addEventListener('click', renderPage);
            fragment.append(more);
        }
        list.append(fragment);
        updateStatus();
    };

    const render = () => {
        current = searchChat(input.value);
        shown = 0;
        list.innerHTML = '';
        list.scrollTop = 0;
        renderPage();
    };

    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(render, 200);
    });

    await popup.show();
    clearTimeout(timer);
}

// ---------- N턴 / N토큰 알림 ----------

/** 메시지 텍스트별 토큰 수 캐시 (토크나이저 호출 줄이기) */
const tokenCache = new Map();

async function countMessageTokens(message) {
    const text = String(message?.mes ?? '');
    if (tokenCache.has(text)) return tokenCache.get(text);
    const count = await ctx().getTokenCountAsync(text);
    tokenCache.set(text, count);
    return count;
}

function countTurns() {
    return ctx().chat.filter(m => m && !m.is_user && !m.is_system).length;
}

async function countChatTokens() {
    let total = 0;
    for (const message of ctx().chat) {
        if (!message || message.is_system) continue;
        total += await countMessageTokens(message);
    }
    return total;
}

function getMeta() {
    const meta = ctx().chatMetadata;
    if (!meta) return null;
    meta[META_KEY] ??= {};
    return meta[META_KEY];
}

/**
 * value가 every의 새 배수를 넘었으면 true. 처음 보는 채팅은 현재 값으로 기준만 잡는다.
 * 메시지를 지워 값이 줄면 기준도 같이 내려서, 다시 넘을 때 알린다.
 */
function crossed(meta, key, value, every) {
    const bucket = Math.floor(value / every);
    const prev = meta[key];
    meta[key] = bucket;
    if (prev === undefined) return false;
    return bucket > prev;
}

let checking = false;

async function checkAlerts({ turns = true } = {}) {
    const s = getSettings();
    if ((!s.turnAlert && !s.tokenAlert) || checking) return;
    if (!ctx().getCurrentChatId?.()) return;
    const meta = getMeta();
    if (!meta) return;

    checking = true;
    try {
        let changed = false;

        if (s.turnAlert && turns && s.turnEvery > 0) {
            const before = meta.turnBucket;
            const count = countTurns();
            if (crossed(meta, 'turnBucket', count, s.turnEvery)) {
                toastr.info(`${count}턴째입니다.`, '턴 알림', { timeOut: 10000, closeButton: true });
            }
            changed ||= before !== meta.turnBucket;
        }

        if (s.tokenAlert && s.tokenEvery > 0) {
            const before = meta.tokenBucket;
            const total = await countChatTokens();
            if (crossed(meta, 'tokenBucket', total, s.tokenEvery)) {
                const passed = meta.tokenBucket * s.tokenEvery;
                toastr.info(`채팅이 ${passed.toLocaleString()} 토큰을 넘었습니다. (현재 ${total.toLocaleString()})`, '토큰 알림', { timeOut: 10000, closeButton: true });
            }
            changed ||= before !== meta.tokenBucket;
        }

        if (changed) ctx().saveMetadataDebounced();
    } catch (error) {
        console.error('[Chat Navigator] 알림 확인 실패', error);
    } finally {
        checking = false;
    }
}

// ---------- 맨 위 / 맨 아래 ----------

async function goTop() {
    if (!hasChat() || !ctx().chat.length) return;
    if (!await confirmFarJump(0)) return;
    await jumpTo(0);
}

function goBottom() {
    if (!hasChat()) return;
    const container = document.getElementById('chat');
    container.scrollTop = container.scrollHeight;
}

// ---------- 책갈피 ----------
// 번호가 아니라 메시지 자체(extra)에 표시해 둔다. 앞 메시지를 지워 번호가 바뀌어도 따라간다.

const BOOKMARK_KEY = 'chatnav_bookmark';
const NOTE_KEY = 'chatnav_bookmark_note';
const NOTE_MAX = 40;
const BOOKMARK_BUTTON = '<div title="책갈피" class="mes_button chatnav_bookmark_button fa-regular fa-star"></div>';
const DELETE_BUTTON = '<div title="이 메시지 삭제" class="mes_button chatnav_delete_button fa-solid fa-trash-can"></div>';

function isBookmarked(message) {
    return !!message?.extra?.[BOOKMARK_KEY];
}

function bookmarkNote(message) {
    return String(message?.extra?.[NOTE_KEY] ?? '');
}

function bookmarkedIndices() {
    const indices = [];
    ctx().chat.forEach((message, index) => {
        if (isBookmarked(message)) indices.push(index);
    });
    return indices;
}

async function setBookmark(index, on) {
    const message = ctx().chat[index];
    if (!message) return;
    message.extra ??= {};
    if (on) message.extra[BOOKMARK_KEY] = true;
    else {
        delete message.extra[BOOKMARK_KEY];
        delete message.extra[NOTE_KEY];
    }
    paintBookmarks();
    await ctx().saveChat();
}

/** 책갈피에 메모(장면 이름 등)를 단다. 빈 값이면 지운다 */
async function setBookmarkNote(index, note) {
    const message = ctx().chat[index];
    if (!message || !isBookmarked(message)) return;
    const text = String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    if (text) message.extra[NOTE_KEY] = text;
    else delete message.extra[NOTE_KEY];
    paintBookmarks();
    await ctx().saveChat();
}

/** 이름 옆에 붙일 짧은 메모 */
function shortNote(note) {
    return note.length > 16 ? note.slice(0, 16) + '…' : note;
}

/** 화면에 그려진 메시지에 책갈피 표시(이름 옆 별, 버튼 채움)를 맞춘다. */
function paintBookmarks() {
    const chat = ctx().chat;
    for (const element of document.querySelectorAll('#chat .mes')) {
        const on = isBookmarked(chat[Number(element.getAttribute('mesid'))]);
        element.classList.toggle('chatnav_bookmarked', on);
        // CSS attr()는 ::after 가 붙은 요소의 속성을 읽으므로 이름 요소에 단다
        const note = on ? bookmarkNote(chat[Number(element.getAttribute('mesid'))]) : '';
        const nameText = element.querySelector('.name_text');
        if (nameText) {
            if (note) nameText.dataset.chatnavNote = shortNote(note);
            else delete nameText.dataset.chatnavNote;
        }
        const button = element.querySelector('.chatnav_bookmark_button');
        if (button) {
            button.classList.toggle('fa-solid', on);
            button.classList.toggle('fa-regular', !on);
            button.title = on ? '책갈피 빼기' : '책갈피';
        }
    }
}

function addBookmarkButtons() {
    // 앞으로 그려질 메시지는 템플릿에서, 이미 그려진 메시지는 직접 넣는다
    $('#message_template .extraMesButtons').prepend(BOOKMARK_BUTTON);
    $('#chat .extraMesButtons').each(function () {
        if (!$(this).find('.chatnav_bookmark_button').length) $(this).prepend(BOOKMARK_BUTTON);
    });

    $(document).on('click', '.chatnav_bookmark_button', function () {
        const index = Number($(this).closest('.mes').attr('mesid'));
        const on = !isBookmarked(ctx().chat[index]);
        setBookmark(index, on);
        toastr.info(on ? `#${index} 책갈피에 추가했습니다.` : `#${index} 책갈피를 뺐습니다.`, '', { timeOut: 1500 });
    });

    // ⋯ 메뉴의 삭제. ST 기본 삭제는 편집 모드에 들어가야 보여서 따로 둔다.
    // 맨 끝에 두어 책갈피(맨 앞)와 떨어뜨린다. 확인은 범위 삭제와 같은 흐름(책갈피면 따로 묻기).
    $('#message_template .extraMesButtons').append(DELETE_BUTTON);
    $('#chat .extraMesButtons').each(function () {
        if (!$(this).find('.chatnav_delete_button').length) $(this).append(DELETE_BUTTON);
    });
    $(document).on('click', '.chatnav_delete_button', function () {
        const message = ctx().chat[Number($(this).closest('.mes').attr('mesid'))];
        if (message) confirmAndDelete([message]);
    });

    // 채팅 전환·이전 메시지 불러오기 등으로 메시지가 다시 그려지면 표시를 맞춘다.
    // requestAnimationFrame은 백그라운드 탭에서 멈추므로 타이머를 쓴다.
    let timer = 0;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            paintBookmarks();
            paintSelection();
            updateFloating();
        }, 50);
    }).observe(document.getElementById('chat'), { childList: true });
    paintBookmarks();
}

function plainSnippet(text) {
    const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
    return escapeHtml(flat.length > 120 ? flat.slice(0, 120) + '…' : flat);
}

async function openBookmarksPopup() {
    if (!hasChat()) return;
    const { Popup, POPUP_TYPE } = ctx();

    const root = document.createElement('div');
    root.className = 'chatnav_search';
    root.innerHTML = `
        <h3>책갈피</h3>
        <div class="chatnav_results"></div>
    `;
    const list = root.querySelector('.chatnav_results');

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, leftAlign: true });
    const pick = makePicker(popup);

    const render = () => {
        list.innerHTML = '';
        const chat = ctx().chat;
        const indices = bookmarkedIndices();
        if (!indices.length) {
            list.innerHTML = `
                <div class="chatnav_empty">
                    책갈피가 없습니다.<br>
                    메시지의 <i class="fa-solid fa-ellipsis"></i> 메뉴에서 <i class="fa-regular fa-star"></i>를 누르면 추가되고,<br>
                    여기서 <i class="fa-solid fa-pen"></i>로 장면 이름 같은 메모를 달 수 있습니다.
                </div>`;
            return;
        }
        for (const index of indices) {
            const message = chat[index];
            const note = bookmarkNote(message);
            const row = document.createElement('div');
            row.className = 'chatnav_bookmark_row';
            row.innerHTML = `
                <button type="button" class="chatnav_item">
                    <span class="chatnav_meta"><b>#${index}</b> ${escapeHtml(message?.name)}</span>
                    ${note ? `<span class="chatnav_note"><i class="fa-solid fa-star"></i> ${escapeHtml(note)}</span>` : ''}
                    <span class="chatnav_snippet">${plainSnippet(message?.mes)}</span>
                </button>
                <button type="button" class="chatnav_edit fa-solid fa-pen" title="메모" aria-label="메모 달기"></button>
                <button type="button" class="chatnav_remove fa-solid fa-xmark" title="책갈피 빼기" aria-label="책갈피 빼기"></button>
            `;
            row.querySelector('.chatnav_item').addEventListener('click', () => pick(index));
            row.querySelector('.chatnav_edit').addEventListener('click', async () => {
                const { callGenericPopup, POPUP_TYPE } = ctx();
                const value = await callGenericPopup(
                    `<span class="chatnav_popup">#${index} 책갈피 메모<br><small>장면 이름처럼 짧게 (${NOTE_MAX}자까지). 비우면 지웁니다.</small></span>`,
                    POPUP_TYPE.INPUT, note, { okButton: '저장', cancelButton: '취소' });
                if (value === null || value === false) return;
                await setBookmarkNote(index, value);
                render();
            });
            row.querySelector('.chatnav_remove').addEventListener('click', async () => {
                await setBookmark(index, false);
                render();
            });
            list.append(row);
        }
    };

    render();
    await popup.show();
}

// ---------- 범위 입력 (숨기기·삭제 공용) ----------

/**
 * 시작~끝 번호 입력 폼. describe(range)가 돌려준 문구를 아래 상태 줄에 보여 준다.
 * 시작과 끝을 거꾸로 넣어도 맞춰서 읽는다.
 */
function buildRangeForm({ title, hint, from = '', to = '', describe }) {
    const last = ctx().chat.length - 1;
    const root = document.createElement('div');
    root.className = 'chatnav_hide';
    root.innerHTML = `
        <h3>${title}</h3>
        <p class="chatnav_hint">${hint}</p>
        <div class="chatnav_range">
            <label>시작 <input type="number" class="text_pole chatnav_from" min="0" max="${last}" value="${from}" inputmode="numeric"></label>
            <span>~</span>
            <label>끝 <input type="number" class="text_pole chatnav_to" min="0" max="${last}" value="${to}" inputmode="numeric"></label>
        </div>
        <div class="chatnav_status"></div>
    `;
    const fromInput = root.querySelector('.chatnav_from');
    const toInput = root.querySelector('.chatnav_to');
    const status = root.querySelector('.chatnav_status');

    const readRange = () => {
        if (fromInput.value === '' || toInput.value === '') return null;
        let start = Math.floor(Number(fromInput.value));
        let end = Math.floor(Number(toInput.value));
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (start > end) [start, end] = [end, start];
        if (start < 0 || end > last) return null;
        return { from: start, to: end, count: end - start + 1 };
    };
    const updateStatus = () => {
        const range = readRange();
        status.innerHTML = range ? describe(range) : `0 ~ ${last} 사이 번호를 넣으세요.`;
    };
    fromInput.addEventListener('input', updateStatus);
    toInput.addEventListener('input', updateStatus);
    updateStatus();

    return { root, readRange, last, focus: () => (fromInput.value === '' ? fromInput : toInput).focus() };
}

// ---------- 범위 숨기기 / 되돌리기 ----------

async function openHidePopup() {
    if (!hasChat()) return;
    const { chat, Popup, POPUP_TYPE, POPUP_RESULT } = ctx();
    if (!chat.length) return;
    const last = chat.length - 1;
    const UNHIDE = 2;

    const form = buildRangeForm({
        title: '범위 숨기기',
        hint: `숨긴 메시지는 화면에 남지만 AI에게 보내지 않습니다. 처음 범위는 최근 ${KEEP_RECENT}개를 남기도록 잡혀 있습니다.`,
        // 기본값은 최근 KEEP_RECENT개를 남기는 범위. 바로 눌러도 전체가 숨겨지지 않게.
        // 메시지가 그보다 적으면 숨길 게 없으니 끝 칸을 비워 둔다.
        from: 0,
        to: last >= KEEP_RECENT ? last - KEEP_RECENT : '',
        describe: ({ from, to, count }) => {
            const hidden = chat.slice(from, to + 1).filter(m => m?.is_system).length;
            return `메시지 ${count.toLocaleString()}개 · 지금 숨김 ${hidden.toLocaleString()}개`;
        },
    });

    const popup = new Popup(form.root, POPUP_TYPE.CONFIRM, '', {
        okButton: '숨기기',
        cancelButton: '취소',
        customButtons: [{ text: '되돌리기', result: UNHIDE }],
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE && result !== UNHIDE) return;

    const range = form.readRange();
    if (!range) {
        toastr.warning(`0 ~ ${last} 사이 번호를 넣으세요.`);
        return;
    }
    const unhide = result === UNHIDE;
    await ctx().executeSlashCommandsWithOptions(`/${unhide ? 'unhide' : 'hide'} ${range.from}-${range.to}`);
    toastr.success(`#${range.from} ~ #${range.to} (${range.count.toLocaleString()}개)를 ${unhide ? '되돌렸습니다' : '숨겼습니다'}.`);
}

// ---------- 삭제 (범위·골라서 공용) ----------

/** 메시지 객체들의 현재 번호(오름차순). 이미 지워진 건 빠진다. */
function indicesOf(messages) {
    const wanted = new Set(messages);
    const indices = [];
    ctx().chat.forEach((message, index) => {
        if (wanted.has(message)) indices.push(index);
    });
    return indices;
}

/** [3,4,5,9] → [{from:3,to:5},{from:9,to:9}] */
function toRuns(indices) {
    const runs = [];
    for (const index of indices) {
        const lastRun = runs[runs.length - 1];
        if (lastRun && lastRun.to === index - 1) lastRun.to = index;
        else runs.push({ from: index, to: index });
    }
    return runs;
}

function describeRuns(runs) {
    return runs.slice(0, 5).map(r => (r.from === r.to ? `#${r.from}` : `#${r.from} ~ #${r.to}`)).join(', ')
        + (runs.length > 5 ? ` 외 ${runs.length - 5}곳` : '');
}

/**
 * 확인하고 지운다. 지웠으면 true.
 * 책갈피한 메시지가 섞여 있으면 먼저 따로 묻는다. 기본(엔터)은 '책갈피 빼고 삭제'.
 * 번호가 아니라 메시지 객체로 받아서, 확인 창을 띄운 사이 채팅이 바뀌어도 지울 때 번호를 다시 계산한다.
 */
async function confirmAndDelete(messages) {
    const { chat, callGenericPopup, POPUP_TYPE, POPUP_RESULT } = ctx();
    let targets = indicesOf(messages).map(i => chat[i]);
    if (!targets.length) return false;

    const marked = targets.filter(isBookmarked);
    let keptMarks = 0;
    if (marked.length) {
        const DELETE_ALL = 2;
        const items = marked.slice(0, 10).map(m => `
            <li><b>#${chat.indexOf(m)}</b> ${escapeHtml(m.name)} · ${plainSnippet(m.mes)}</li>`).join('');
        const more = marked.length > 10 ? `<p>외 ${marked.length - 10}개</p>` : '';
        // 전부 책갈피면 '빼고 삭제'는 남는 게 없으니 묻지 않고, 책갈피째 지울지만 묻는다
        const allMarked = marked.length === targets.length;
        const result = await callGenericPopup(`
            <div class="chatnav_popup chatnav_mark_warn">
                <h3><i class="fa-solid fa-star"></i> ${allMarked && marked.length === 1 ? '책갈피한 메시지입니다' : `책갈피한 메시지 ${marked.length}개가 포함되어 있습니다`}</h3>
                <ul>${items}</ul>${more}
                <p>${allMarked ? '책갈피째 삭제할까요?' : '책갈피한 메시지는 남기고 나머지만 지울까요?'}</p>
            </div>`, POPUP_TYPE.CONFIRM, '', allMarked ? {
            okButton: '책갈피째 삭제',
            cancelButton: '취소',
        } : {
            okButton: '책갈피 빼고 삭제',
            cancelButton: '취소',
            customButtons: [{ text: '모두 삭제', result: DELETE_ALL, classes: ['chatnav_danger_button'] }],
        });
        if (allMarked) {
            if (result !== POPUP_RESULT.AFFIRMATIVE) return false;
        } else if (result === POPUP_RESULT.AFFIRMATIVE) {
            targets = targets.filter(m => !isBookmarked(m));
            keptMarks = marked.length;
        } else if (result !== DELETE_ALL) {
            return false;
        }
        if (!targets.length) {
            toastr.info('책갈피를 빼니 지울 메시지가 없습니다.');
            return false;
        }
    }

    // 마지막 확인
    const indices = indicesOf(targets);
    const lostMarks = keptMarks ? 0 : marked.length;
    const lines = [
        `메시지 <b>${indices.length.toLocaleString()}개</b>를 삭제합니다.`,
        describeRuns(toRuns(indices)),
        keptMarks ? `책갈피 ${keptMarks}개는 남깁니다.` : '',
        lostMarks ? `<b>책갈피 ${lostMarks}개도 함께 사라집니다.</b>` : '',
        indices.length === chat.length ? '<b>채팅의 모든 메시지</b>입니다.' : '',
        indices.length > FAR_JUMP ? '개수가 많아 시간이 걸릴 수 있습니다.' : '',
        '되돌릴 수 없습니다.',
    ].filter(Boolean);
    const confirmed = await callGenericPopup(`<span class="chatnav_popup">${lines.join('<br>')}</span>`, POPUP_TYPE.CONFIRM, '', {
        okButton: '삭제',
        cancelButton: '취소',
    });
    if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return false;

    const progress = indices.length > 20
        ? toastr.info(`메시지 ${indices.length.toLocaleString()}개를 삭제하는 중…`, '', { timeOut: 0, extendedTimeOut: 0 })
        : null;
    try {
        // 뒤 구간부터 지워서 앞 번호가 밀리지 않게 한다
        for (const run of toRuns(indicesOf(targets)).reverse()) {
            await ctx().executeSlashCommandsWithOptions(`/cut ${run.from}-${run.to}`);
        }
        toastr.success(`메시지 ${indices.length.toLocaleString()}개를 삭제했습니다.` + (keptMarks ? ` (책갈피 ${keptMarks}개는 남김)` : ''));
    } finally {
        if (progress) toastr.clear(progress);
    }
    return true;
}

// ---------- 범위 삭제 ----------

async function openDeletePopup() {
    if (!hasChat()) return;
    const { chat, Popup, POPUP_TYPE, POPUP_RESULT } = ctx();
    if (!chat.length) return;

    const countBookmarks = ({ from, to }) => chat.slice(from, to + 1).filter(isBookmarked).length;

    // 삭제는 되돌릴 수 없으니 기본값 없이 비워 둔다
    const form = buildRangeForm({
        title: '범위 삭제',
        hint: '삭제한 메시지는 되돌릴 수 없습니다. AI에게만 안 보내려면 <b>범위 숨기기</b>를 쓰세요.',
        describe: (range) => {
            const marks = countBookmarks(range);
            return `메시지 <b>${range.count.toLocaleString()}개</b> 삭제` + (marks ? ` · 책갈피 ${marks}개 포함` : '');
        },
    });

    const popup = new Popup(form.root, POPUP_TYPE.CONFIRM, '', {
        okButton: '다음',
        cancelButton: '취소',
        onOpen: form.focus,
    });
    if (await popup.show() !== POPUP_RESULT.AFFIRMATIVE) return;

    const range = form.readRange();
    if (!range) {
        toastr.warning(`0 ~ ${form.last} 사이 번호를 넣으세요.`);
        return;
    }
    await confirmAndDelete(chat.slice(range.from, range.to + 1));
}

// ---------- 골라서 숨기기·삭제 (선택 모드) ----------
// 메시지를 탭해서 고른다. 고른 건 번호가 아니라 메시지 객체로 기억해서,
// 중간에 메시지가 지워지거나 다시 그려져도 실행 직전에 번호를 다시 계산한다.

const selection = {
    active: false,
    picked: new Set(),
    rangeMode: false,
    anchor: null,
    bar: null,
};

function isGeneratingNow() {
    return $('#mes_stop').is(':visible');
}

/** 고른 메시지의 현재 번호(오름차순) */
function pickedIndices() {
    const indices = [];
    ctx().chat.forEach((message, index) => {
        if (selection.picked.has(message)) indices.push(index);
    });
    return indices;
}

function paintSelection() {
    if (!selection.active) return;
    const chat = ctx().chat;
    for (const element of document.querySelectorAll('#chat .mes')) {
        const message = chat[Number(element.getAttribute('mesid'))];
        element.classList.toggle('chatnav_picked', selection.picked.has(message));
        element.classList.toggle('chatnav_anchor', !!message && message === selection.anchor);
    }
}

function updateSelectionBar() {
    const bar = selection.bar;
    if (!bar) return;
    const count = pickedIndices().length;
    bar.querySelector('.chatnav_sel_count').textContent = `${count.toLocaleString()}개 선택`;
    bar.querySelector('.chatnav_sel_hint').textContent = selection.rangeMode
        ? (selection.anchor ? '범위: 끝 메시지를 탭하세요' : '범위: 시작 메시지를 탭하세요')
        : '메시지를 탭해서 고르세요';
    const rangeButton = bar.querySelector('[data-act="range"]');
    rangeButton.classList.toggle('chatnav_on', selection.rangeMode);
    rangeButton.setAttribute('aria-pressed', String(selection.rangeMode));
    for (const button of bar.querySelectorAll('[data-needs-pick]')) {
        button.disabled = count === 0;
    }
    paintSelection();
}

function onSelectClick(event) {
    if (!selection.active) return;
    const element = event.target.closest?.('#chat .mes');
    if (!element) return; // '이전 메시지 더 보기' 같은 건 그대로 둔다

    // 편집·스와이프·링크·다른 확장의 클릭이 같이 실행되지 않게 여기서 막는다
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const index = Number(element.getAttribute('mesid'));
    const chat = ctx().chat;
    const message = chat[index];
    if (!message) return;

    if (selection.rangeMode) {
        if (!selection.anchor || !chat.includes(selection.anchor)) {
            selection.anchor = message;
        } else {
            const anchorIndex = chat.indexOf(selection.anchor);
            const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
            for (let i = from; i <= to; i++) selection.picked.add(chat[i]);
            selection.anchor = null;
            selection.rangeMode = false;
        }
    } else if (selection.picked.has(message)) {
        selection.picked.delete(message);
    } else {
        selection.picked.add(message);
    }
    updateSelectionBar();
}

function onSelectKey(event) {
    if (selection.active && event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        exitSelectMode();
    }
}

function enterSelectMode() {
    if (!hasChat()) return;
    if (selection.active) return;
    if (isGeneratingNow()) {
        toastr.warning('답변을 생성하는 중에는 고를 수 없습니다.');
        return;
    }
    if ($('#dialogue_del_mes').is(':visible')) {
        toastr.warning('ST 삭제 모드를 먼저 끝내 주세요.');
        return;
    }
    if (document.getElementById('curEditTextarea')) {
        toastr.warning('편집 중인 메시지를 먼저 끝내 주세요.');
        return;
    }

    selection.active = true;
    selection.picked = new Set();
    selection.rangeMode = false;
    selection.anchor = null;

    const bar = document.createElement('div');
    bar.id = 'chatnav_select_bar';
    bar.innerHTML = `
        <div class="chatnav_sel_row">
            <div class="chatnav_sel_info">
                <b class="chatnav_sel_count"></b>
                <span class="chatnav_sel_hint"></span>
            </div>
            <button type="button" class="menu_button" data-act="range" aria-pressed="false"><i class="fa-solid fa-arrows-up-down"></i>범위</button>
            <button type="button" class="menu_button" data-act="clear" data-needs-pick>해제</button>
        </div>
        <div class="chatnav_sel_row">
            <button type="button" class="menu_button" data-act="hide" data-needs-pick><i class="fa-solid fa-eye-slash"></i>숨기기</button>
            <button type="button" class="menu_button" data-act="unhide" data-needs-pick><i class="fa-solid fa-eye"></i>되돌리기</button>
            <button type="button" class="menu_button chatnav_danger" data-act="delete" data-needs-pick><i class="fa-solid fa-trash-can"></i>삭제</button>
            <button type="button" class="menu_button" data-act="done">완료</button>
        </div>
    `;
    bar.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-act]');
        if (!button || button.disabled) return;
        const act = button.dataset.act;
        if (act === 'range') {
            selection.rangeMode = !selection.rangeMode;
            selection.anchor = null;
            updateSelectionBar();
        } else if (act === 'clear') {
            selection.picked.clear();
            selection.anchor = null;
            updateSelectionBar();
        } else if (act === 'hide' || act === 'unhide') {
            applyHide(act === 'unhide');
        } else if (act === 'delete') {
            applyDelete();
        } else if (act === 'done') {
            exitSelectMode();
        }
    });

    // 입력창 자리에 막대를 넣는다(입력창은 선택 모드 동안 가린다)
    const form = document.getElementById('form_sheld');
    form.before(bar);
    form.classList.add('chatnav_hidden');
    selection.bar = bar;

    document.body.classList.add('chatnav_selecting');
    document.getElementById('chat').addEventListener('click', onSelectClick, true);
    document.addEventListener('keydown', onSelectKey);
    updateSelectionBar();
}

function exitSelectMode() {
    if (!selection.active) return;
    selection.active = false;
    selection.picked.clear();
    selection.anchor = null;
    selection.rangeMode = false;
    selection.bar?.remove();
    selection.bar = null;
    document.getElementById('form_sheld')?.classList.remove('chatnav_hidden');
    document.body.classList.remove('chatnav_selecting');
    document.getElementById('chat').removeEventListener('click', onSelectClick, true);
    document.removeEventListener('keydown', onSelectKey);
    for (const element of document.querySelectorAll('#chat .mes.chatnav_picked, #chat .mes.chatnav_anchor')) {
        element.classList.remove('chatnav_picked', 'chatnav_anchor');
    }
}

let applying = false;

async function applyHide(unhide) {
    if (applying) return;
    const indices = pickedIndices();
    if (!indices.length) return;
    applying = true;
    try {
        for (const run of toRuns(indices)) {
            await ctx().executeSlashCommandsWithOptions(`/${unhide ? 'unhide' : 'hide'} ${run.from}-${run.to}`);
        }
        toastr.success(`메시지 ${indices.length.toLocaleString()}개를 ${unhide ? '되돌렸습니다' : '숨겼습니다'}.`);
        selection.picked.clear();
        updateSelectionBar();
    } finally {
        applying = false;
    }
}

async function applyDelete() {
    if (applying || !selection.picked.size) return;
    applying = true;
    try {
        if (await confirmAndDelete([...selection.picked])) {
            selection.picked.clear();
            if (selection.active) updateSelectionBar();
        }
    } finally {
        applying = false;
    }
}

// ---------- 이 채팅 정보 ----------
// 지금 열린 채팅만 다룬다. 요약, 페르소나, 작가 노트, 채팅 덮어쓰기, 로어북.
// 페르소나·작가 노트·덮어쓰기·로어북 값은 모두 chat_metadata에 들어 있다.
// getContext에 없는 기능은 ST 모듈(personas.js, world-info.js, script.js)을 직접 쓴다.

const CHAT_LOREBOOK_KEY = 'world_info';

const stModules = {};
function stModule(path) {
    stModules[path] ??= import(path);
    return stModules[path];
}
const getPersonas = () => stModule('../../../personas.js');
const getWorldInfo = () => stModule('../../../world-info.js');
const getScript = () => stModule('../../../../script.js');

function personaNames() {
    const personas = ctx().powerUserSettings.personas ?? {};
    return Object.entries(personas)
        .map(([key, name]) => ({ key, name: String(name || key) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function setChatLorebook(name) {
    const { chatMetadata, saveMetadata } = ctx();
    if (name) {
        chatMetadata[CHAT_LOREBOOK_KEY] = name;
    } else {
        delete chatMetadata[CHAT_LOREBOOK_KEY];
    }
    $('.chat_lorebook_button').toggleClass('world_set', !!name);
    await saveMetadata();
}

/** 지금 채팅의 캐릭터(그룹이면 멤버 전부)에 묶인 로어북 */
function characterLorebooks(worldInfo) {
    const c = ctx();
    const members = c.groupId
        ? (c.groups.find(g => g.id == c.groupId)?.members ?? []).map(avatar => c.characters.find(ch => ch.avatar === avatar))
        : [c.characters[c.characterId]];
    const result = [];
    for (const character of members.filter(Boolean)) {
        const file = character.avatar?.replace(/\.[^/.]+$/, '');
        const books = [
            character.data?.extensions?.world,
            ...(worldInfo.world_info?.charLore?.find(e => e.name === file)?.extraBooks ?? []),
        ].filter(Boolean);
        if (books.length) result.push({ name: character.name, books: [...new Set(books)] });
    }
    return result;
}

function formatSendDate(value) {
    if (!value) return '';
    const date = ctx().timestampToMoment?.(value);
    return date?.isValid?.() ? date.format('YYYY-MM-DD HH:mm') : String(value);
}

function previewText(text, max = 80) {
    const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

// 잘 안 쓰는 칸(작가 노트·덮어쓰기)은 접어 두고, 머리에 불빛으로 내용이 있는지만 보여 준다.
function foldSummary(icon, title) {
    return `
        <summary class="chatnav_info_title chatnav_info_fold_head">
            <i class="fa-solid ${icon}"></i>
            <span>${title}</span>
            <span class="chatnav_info_lamp"></span>
            <span class="chatnav_info_lamp_text"></span>
            <i class="fa-solid fa-chevron-down chatnav_info_fold_chevron"></i>
        </summary>`;
}

/** state: on(초록) / warn(노랑, 내용은 있지만 적용 안 됨) / off(회색) */
function setLamp(fold, state, text) {
    fold.dataset.lamp = state;
    fold.querySelector('.chatnav_info_lamp_text').textContent = text;
}

// 작가 노트는 ST의 작가 노트 패널 입력칸에 값을 넣고 이벤트를 보낸다.
// 그래야 저장·토큰 카운터·패널 표시가 ST 방식 그대로 맞춰진다.
const AN_POSITION = { before: 2, after: 0, chat: 1 };

function setAuthorsNote(field, value) {
    switch (field) {
        case 'prompt':
            $('#extension_floating_prompt').val(value).trigger('input');
            break;
        case 'interval':
            $('#extension_floating_interval').val(value).trigger('input');
            break;
        case 'depth':
            $('#extension_floating_depth').val(value).trigger('input');
            break;
        case 'role':
            $('#extension_floating_role').val(value).trigger('input');
            break;
        case 'position':
            $(`input[name="extension_floating_position"][value="${value}"]`).prop('checked', true).trigger('change');
            break;
    }
}

async function openChatInfoPopup() {
    if (!hasChat()) return;
    const { Popup, POPUP_TYPE } = ctx();
    const [personas, worldInfo] = await Promise.all([getPersonas(), getWorldInfo()]);

    const root = document.createElement('div');
    root.className = 'chatnav_search chatnav_info';
    root.innerHTML = `
        <h3>이 채팅 정보</h3>

        <div class="chatnav_info_section">
            <div class="chatnav_info_summary"></div>
        </div>

        <div class="chatnav_info_section">
            <div class="chatnav_info_title"><i class="fa-solid fa-user"></i> 페르소나</div>
            <div class="chatnav_info_persona">
                <img class="chatnav_info_avatar" alt="">
                <select class="text_pole chatnav_input chatnav_info_persona_select"></select>
            </div>
            <label class="checkbox_label chatnav_info_check">
                <input type="checkbox" class="chatnav_info_lock">
                <span>이 채팅에 고정</span>
            </label>
            <div class="chatnav_status chatnav_info_persona_status"></div>
        </div>

        <details class="chatnav_info_section chatnav_info_fold chatnav_info_note_fold">
            ${foldSummary('fa-feather-pointed', '작가 노트')}
            <textarea class="text_pole chatnav_input chatnav_info_note" rows="4" placeholder="비어 있으면 넣지 않습니다."></textarea>
            <div class="chatnav_info_fields">
                <label>위치
                    <select class="text_pole chatnav_info_note_position">
                        <option value="${AN_POSITION.before}">시나리오 앞</option>
                        <option value="${AN_POSITION.after}">시나리오 뒤</option>
                        <option value="${AN_POSITION.chat}">채팅 안</option>
                    </select>
                </label>
                <label class="chatnav_info_in_chat">깊이
                    <input type="number" min="0" max="9999" class="text_pole chatnav_info_note_depth">
                </label>
                <label class="chatnav_info_in_chat">역할
                    <select class="text_pole chatnav_info_note_role">
                        <option value="0">시스템</option>
                        <option value="1">사용자</option>
                        <option value="2">AI</option>
                    </select>
                </label>
                <label>간격
                    <input type="number" min="0" max="999" class="text_pole chatnav_info_note_interval">
                </label>
            </div>
            <div class="chatnav_status chatnav_info_note_status"></div>
        </details>

        <details class="chatnav_info_section chatnav_info_fold chatnav_info_override_fold">
            ${foldSummary('fa-masks-theater', '채팅 덮어쓰기')}
            <div class="chatnav_info_overrides"></div>
            <button type="button" class="menu_button chatnav_info_override_edit">
                <i class="fa-solid fa-pen"></i> 편집
            </button>
        </details>

        <div class="chatnav_info_section">
            <div class="chatnav_info_title"><i class="fa-solid fa-book-atlas"></i> 로어북</div>
            <div class="chatnav_info_label">채팅 로어북 <small>(이 채팅에서만)</small></div>
            <div class="chatnav_info_world_row">
                <select class="text_pole chatnav_input chatnav_info_world_select"></select>
                <button type="button" class="menu_button chatnav_info_icon_button chatnav_info_world_open fa-solid fa-pen" title="로어북 편집기에서 열기" aria-label="로어북 편집기에서 열기"></button>
                <button type="button" class="menu_button chatnav_info_icon_button chatnav_info_world_new fa-solid fa-plus" title="새 로어북 만들어 연결" aria-label="새 로어북 만들어 연결"></button>
            </div>
            <div class="chatnav_status chatnav_info_world_status"></div>
            <div class="chatnav_info_label">지금 적용되는 로어북</div>
            <div class="chatnav_info_books"></div>
        </div>
    `;
    const find = (selector) => root.querySelector(selector);

    // ----- 요약 -----
    const renderSummary = () => {
        const { chat, getCurrentChatId } = ctx();
        const hidden = chat.filter(m => m?.is_system).length;
        const first = formatSendDate(chat[0]?.send_date);
        const last = formatSendDate(chat[chat.length - 1]?.send_date);
        find('.chatnav_info_summary').innerHTML = `
            <div class="chatnav_info_file">${escapeHtml(getCurrentChatId())}</div>
            <div class="chatnav_info_stats">
                <span>메시지 <b>${chat.length.toLocaleString()}</b>개${hidden ? ` · 숨김 ${hidden.toLocaleString()}개` : ''}</span>
                <span>토큰 <b class="chatnav_info_tokens">계산 중…</b></span>
                ${first ? `<span>${escapeHtml(first)}${last && last !== first ? ` ~ ${escapeHtml(last)}` : ''}</span>` : ''}
            </div>`;
        const tokens = find('.chatnav_info_tokens');
        countChatTokens()
            .then(total => { tokens.textContent = `약 ${total.toLocaleString()}`; })
            .catch(() => { tokens.textContent = '알 수 없음'; });
    };

    // ----- 페르소나 -----
    const personaSelect = find('.chatnav_info_persona_select');
    const lock = find('.chatnav_info_lock');

    const renderPersona = () => {
        const current = personas.user_avatar;
        const list = personaNames();
        // 페르소나로 저장되지 않은 이름·아바타로 대화 중일 수도 있다
        if (current && !list.some(p => p.key === current)) {
            list.unshift({ key: current, name: `${ctx().name1} (저장 안 된 페르소나)` });
        }
        personaSelect.innerHTML = list
            .map(p => `<option value="${escapeHtml(p.key)}"${p.key === current ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
            .join('');
        const avatar = find('.chatnav_info_avatar');
        avatar.src = current ? ctx().getThumbnailUrl('persona', current) : '';
        avatar.hidden = !current;

        const locked = personas.isPersonaLocked('chat');
        lock.checked = locked;
        const lockedKey = ctx().chatMetadata.persona;
        const status = find('.chatnav_info_persona_status');
        if (locked) {
            status.textContent = '이 채팅을 열면 항상 이 페르소나로 바뀝니다.';
        } else if (lockedKey) {
            const name = ctx().powerUserSettings.personas?.[lockedKey] ?? lockedKey;
            status.textContent = `이 채팅은 '${name}'에 고정되어 있지만 지금은 다른 페르소나입니다.`;
        } else {
            status.textContent = '고정 안 됨. 지금 선택된 페르소나로 대화합니다.';
        }
    };

    personaSelect.addEventListener('change', async () => {
        const wasLocked = personas.isPersonaLocked('chat');
        await personas.setUserAvatar(personaSelect.value);
        // 고정돼 있었으면 바꾼 페르소나로 다시 고정 (자동 고정 설정이 켜져 있으면 ST가 이미 했다)
        if (wasLocked && !personas.isPersonaLocked('chat')) {
            await personas.setPersonaLockState(true, 'chat');
        }
        renderPersona();
        renderBooks(); // 페르소나 로어북이 바뀔 수 있다
    });

    lock.addEventListener('change', async () => {
        await personas.setPersonaLockState(lock.checked, 'chat');
        renderPersona();
    });

    // ----- 작가 노트 -----
    const note = find('.chatnav_info_note');
    const notePosition = find('.chatnav_info_note_position');
    const noteDepth = find('.chatnav_info_note_depth');
    const noteRole = find('.chatnav_info_note_role');
    const noteInterval = find('.chatnav_info_note_interval');

    const renderNoteStatus = () => {
        const meta = ctx().chatMetadata;
        const inChat = Number(meta.note_position) === AN_POSITION.chat;
        root.querySelectorAll('.chatnav_info_in_chat').forEach(el => el.hidden = !inChat);
        const interval = Number(meta.note_interval);
        const status = find('.chatnav_info_note_status');
        const fold = find('.chatnav_info_note_fold');
        if (!String(meta.note_prompt ?? '').trim()) {
            status.textContent = '비어 있어서 넣지 않습니다.';
            setLamp(fold, 'off', '비어 있음');
        } else if (!interval) {
            status.textContent = '간격이 0이라 넣지 않습니다.';
            setLamp(fold, 'warn', '내용 있음 · 꺼짐');
        } else {
            status.textContent = interval === 1 ? '매번 넣습니다.' : `메시지 ${interval}개마다 넣습니다.`;
            setLamp(fold, 'on', '사용 중');
        }
    };

    const renderNote = () => {
        const meta = ctx().chatMetadata;
        note.value = meta.note_prompt ?? '';
        notePosition.value = String(meta.note_position ?? AN_POSITION.after);
        noteDepth.value = meta.note_depth ?? 4;
        noteRole.value = String(meta.note_role ?? 0);
        noteInterval.value = meta.note_interval ?? 1;
        renderNoteStatus();
    };

    note.addEventListener('input', () => { setAuthorsNote('prompt', note.value); renderNoteStatus(); });
    notePosition.addEventListener('change', () => { setAuthorsNote('position', notePosition.value); renderNoteStatus(); });
    noteDepth.addEventListener('input', () => { setAuthorsNote('depth', noteDepth.value); renderNoteStatus(); });
    noteRole.addEventListener('change', () => { setAuthorsNote('role', noteRole.value); renderNoteStatus(); });
    noteInterval.addEventListener('input', () => { setAuthorsNote('interval', noteInterval.value); renderNoteStatus(); });

    // ----- 채팅 덮어쓰기 (편집은 ST 자체 창으로) -----
    const renderOverrides = () => {
        const meta = ctx().chatMetadata;
        const rows = [
            ['시나리오', meta.scenario],
            ['예시 대화', meta.mes_example],
            ['시스템 프롬프트', meta.system_prompt],
        ];
        find('.chatnav_info_overrides').innerHTML = rows.map(([label, value]) => `
            <div class="chatnav_info_override${value ? ' chatnav_info_set' : ''}">
                <span class="chatnav_info_override_label">${label}</span>
                <span class="chatnav_info_override_value">${value ? escapeHtml(previewText(value)) : '없음 (캐릭터 카드 그대로)'}</span>
            </div>`).join('');
        const used = rows.filter(([, value]) => value).length;
        setLamp(find('.chatnav_info_override_fold'), used ? 'on' : 'off', used ? `${used}개 사용 중` : '없음');
    };

    find('.chatnav_info_override_edit').addEventListener('click', async () => {
        const script = await getScript();
        await script.setCharacterSettingsOverrides();
        renderOverrides();
    });

    // ----- 로어북 -----
    const worldSelect = find('.chatnav_info_world_select');

    const renderWorld = () => {
        const names = ctx().getWorldInfoNames();
        const current = ctx().chatMetadata[CHAT_LOREBOOK_KEY] ?? '';
        const missing = current && !names.includes(current);
        worldSelect.innerHTML = [
            '<option value="">(없음)</option>',
            missing ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (찾을 수 없음)</option>` : '',
            ...names.map(name => `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}</option>`),
        ].join('');
        find('.chatnav_info_world_open').disabled = !current || missing;
        find('.chatnav_info_world_status').textContent = !current
            ? '이 채팅에만 쓰는 로어북이 없습니다.'
            : missing
                ? '연결된 로어북 파일이 없어서 적용되지 않습니다.'
                : '이 채팅에서만 추가로 적용됩니다.';
    };

    const renderBooks = () => {
        const names = ctx().getWorldInfoNames();
        const chip = (book) => names.includes(book)
            ? `<span class="chatnav_info_chip">${escapeHtml(book)}</span>`
            : `<span class="chatnav_info_chip chatnav_info_missing" title="파일을 찾을 수 없음">${escapeHtml(book)}</span>`;
        // 캐릭터 이름은 왼쪽 칸에 넣으면 길 때 정렬이 깨져서, 오른쪽 칩 위에 따로 한 줄로 둔다
        const group = (label, books, owner = '') => `
            <div class="chatnav_info_book_row">
                <span class="chatnav_info_book_label">${label}</span>
                <span class="chatnav_info_chips">
                    ${owner ? `<span class="chatnav_info_owner"><i class="fa-solid fa-user"></i>${escapeHtml(owner)}</span>` : ''}
                    ${books.length ? books.map(chip).join('') : '<span class="chatnav_info_none">없음</span>'}
                </span>
            </div>`;

        const chatBook = ctx().chatMetadata[CHAT_LOREBOOK_KEY];
        const personaBook = ctx().powerUserSettings.persona_description_lorebook;
        const characters = characterLorebooks(worldInfo);
        const charRows = characters.length
            ? characters.map((c, i) => group(i ? '' : '캐릭터', c.books, c.name)).join('')
            : group('캐릭터', []);

        find('.chatnav_info_books').innerHTML = [
            group('채팅', chatBook ? [chatBook] : []),
            charRows,
            group('페르소나', personaBook ? [personaBook] : []),
            group('전역', [...(worldInfo.selected_world_info ?? [])]),
        ].join('');
    };

    worldSelect.addEventListener('change', async () => {
        await setChatLorebook(worldSelect.value);
        renderWorld();
        renderBooks();
    });

    renderSummary();
    renderPersona();
    renderNote();
    renderOverrides();
    renderWorld();
    renderBooks();

    // 편집기는 ST 왼쪽 서랍이라, 이 창을 닫고 연다
    const openEditor = async (name) => {
        await popup.completeCancelled();
        worldInfo.openWorldInfoEditor(name);
    };

    find('.chatnav_info_world_open').addEventListener('click', () => openEditor(worldSelect.value));

    find('.chatnav_info_world_new').addEventListener('click', async () => {
        const { callGenericPopup, POPUP_TYPE: TYPE, getCurrentChatId } = ctx();
        const input = await callGenericPopup(
            '<span class="chatnav_popup">새 로어북 이름<br><small>만든 뒤 이 채팅에 연결하고 편집기를 엽니다.</small></span>',
            TYPE.INPUT, getCurrentChatId(), { okButton: '만들기', cancelButton: '취소' });
        const name = typeof input === 'string' ? input.trim() : '';
        if (!name) return;
        // ST 생성 함수는 같은 이름이 있으면 덮어쓸지 묻는데, 실수로 기존 로어북을 날리지 않게 여기서 막는다
        if (ctx().getWorldInfoNames().includes(name)) {
            toastr.warning(`'${name}' 로어북이 이미 있습니다. 목록에서 고르거나 다른 이름을 쓰세요.`);
            return;
        }
        if (!await worldInfo.createNewWorldInfo(name)) return;
        await setChatLorebook(name);
        toastr.success(`'${name}' 로어북을 만들어 이 채팅에 연결했습니다.`);
        await openEditor(name);
    });

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '닫기', leftAlign: true, allowVerticalScrolling: true });
    await popup.show();
}

// ---------- 메뉴판 ----------

async function openHub() {
    if (!hasChat()) return;
    exitSelectMode();
    const { Popup, POPUP_TYPE, chat } = ctx();
    const marks = bookmarkedIndices().length;

    const actions = {
        search: openSearchPopup,
        jump: openJumpPopup,
        top: goTop,
        bottom: goBottom,
        bookmarks: openBookmarksPopup,
        hide: openHidePopup,
        pick: enterSelectMode,
        delete: openDeletePopup,
        info: openChatInfoPopup,
    };

    // 검색 / 이동(3칸) / 책갈피 / 정리(목록) 로 묶는다
    const row = (act, icon, label, extra = '') => `
        <button type="button" class="chatnav_hub_row${act === 'delete' ? ' chatnav_hub_danger' : ''}" data-act="${act}">
            <i class="fa-solid ${icon} chatnav_hub_icon"></i>
            <span class="chatnav_hub_label">${label}</span>
            ${extra}
            <i class="fa-solid fa-chevron-right chatnav_hub_chevron"></i>
        </button>`;
    const tile = (act, icon, label) => `
        <button type="button" class="chatnav_hub_tile" data-act="${act}">
            <i class="fa-solid ${icon}"></i>
            <span>${label}</span>
        </button>`;

    const root = document.createElement('div');
    root.className = 'chatnav_hub';
    root.innerHTML = `
        <div class="chatnav_hub_head">
            <div>
                <h3>채팅 내비게이터</h3>
                <div class="chatnav_hub_sub">메시지 ${chat.length.toLocaleString()}개 · #0 ~ #${Math.max(0, chat.length - 1)}</div>
            </div>
            <button type="button" class="chatnav_hub_close" data-act="close" title="닫기" aria-label="닫기">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <button type="button" class="chatnav_hub_search" data-act="search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <span>이 채팅에서 검색</span>
        </button>

        <div class="chatnav_hub_section">이동</div>
        <div class="chatnav_hub_tiles">
            ${tile('jump', 'fa-hashtag', '번호로 이동')}
            ${tile('top', 'fa-angles-up', '맨 위로')}
            ${tile('bottom', 'fa-angles-down', '맨 아래로')}
        </div>

        <div class="chatnav_hub_card">
            ${row('bookmarks', 'fa-star', '책갈피', `<span class="chatnav_hub_badge${marks ? '' : ' chatnav_zero'}">${marks}</span>`)}
        </div>

        <div class="chatnav_hub_card">
            ${row('info', 'fa-circle-info', '이 채팅 정보')}
        </div>

        <div class="chatnav_hub_section">정리</div>
        <div class="chatnav_hub_card">
            ${row('hide', 'fa-eye-slash', '범위 숨기기')}
            ${row('pick', 'fa-list-check', '골라서 숨기기·삭제')}
            ${row('delete', 'fa-trash-can', '범위 삭제')}
        </div>
    `;

    const popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: false });
    root.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-act]');
        if (!button) return;
        await popup.completeCancelled();
        await actions[button.dataset.act]?.();
    });

    await popup.show();
}

// ---------- 떠 있는 맨 위/아래 버튼 (설정에서 켬) ----------
// 채팅 영역 아래 가운데에 작은 알약 모양으로 띄운다. 오른쪽은 메시지의 … ·연필,
// 마지막 AI 메시지의 스와이프 화살표가 있어서 피한다.
// 입력창·선택 막대 높이가 바뀌면 채팅 영역 아래 끝을 따라간다.

const FLOAT_GAP = 12;

let floating = null;
let floatResize = null;
let floatTimer = 0;

function updateFloating() {
    if (!floating) return;
    const chatEl = document.getElementById('chat');
    const sheld = document.getElementById('sheld');
    if (!chatEl || !sheld) return;

    const below = sheld.getBoundingClientRect().bottom - chatEl.getBoundingClientRect().bottom;
    floating.style.bottom = `${Math.max(0, below) + FLOAT_GAP}px`;

    // 화면 위쪽 끝이어도 아직 안 불러온 이전 메시지가 있으면 '맨 위로'는 쓸모가 있다
    const atTop = chatEl.scrollTop <= 4 && firstRenderedIndex() === 0;
    const atBottom = chatEl.scrollHeight - chatEl.clientHeight - chatEl.scrollTop <= 4;
    const s = getSettings();
    const showTop = s.floatTop && !atTop;
    const showBottom = s.floatBottom && !atBottom;
    const open = !!ctx().getCurrentChatId?.() && ctx().chat.length > 0;
    floating.classList.toggle('chatnav_hidden', !open || (!showTop && !showBottom));
    floating.querySelector('[data-act="top"]').classList.toggle('chatnav_off', !showTop);
    floating.querySelector('[data-act="bottom"]').classList.toggle('chatnav_off', !showBottom);
}

function onFloatScroll() {
    clearTimeout(floatTimer);
    floatTimer = setTimeout(updateFloating, 80);
}

function setFloating(on) {
    const chatEl = document.getElementById('chat');
    const sheld = document.getElementById('sheld');
    if (!chatEl || !sheld) return;

    if (on && !floating) {
        floating = document.createElement('div');
        floating.id = 'chatnav_floating';
        floating.innerHTML = `
            <button type="button" data-act="top" title="맨 위로" aria-label="맨 위로"><i class="fa-solid fa-angles-up"></i></button>
            <button type="button" data-act="bottom" title="맨 아래로" aria-label="맨 아래로"><i class="fa-solid fa-angles-down"></i></button>
        `;
        floating.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-act]');
            if (!button) return;
            if (button.dataset.act === 'top') goTop();
            else goBottom();
        });
        sheld.append(floating);
        chatEl.addEventListener('scroll', onFloatScroll, { passive: true });
        floatResize = new ResizeObserver(updateFloating);
        floatResize.observe(chatEl);
        floatResize.observe(sheld);
        updateFloating();
    } else if (on && floating) {
        updateFloating();
    } else if (!on && floating) {
        chatEl.removeEventListener('scroll', onFloatScroll);
        floatResize?.disconnect();
        floatResize = null;
        floating.remove();
        floating = null;
    }
}

// ---------- 답변이 오면 처음 부분에서 멈추기 (설정에서 켬) ----------
// ST는 답변이 오면 맨 아래로 따라 내려가지만, 읽는 건 처음부터다.
// 스트리밍: 답변 머리가 화면 위로 밀려나려는 순간 머리를 화면 맨 위에 고정한다.
//   그러면 ST가 '사용자가 올렸다'로 보고 따라 내려가기를 멈춘다(scrollLock).
// 한 번에 오는 답변: 다 그려지고 맨 아래로 내려간 뒤 답변 머리로 올린다.
// 한 화면에 다 들어오는 짧은 답변이나 이어쓰기(continue)는 건드리지 않는다.

const READ_MARGIN = 8;
const reading = { active: false, streamed: false, pinnedAt: 0 };

function messageTopOffset(element) {
    const chatEl = document.getElementById('chat');
    return element.getBoundingClientRect().top - chatEl.getBoundingClientRect().top;
}

function pinMessageTop(element) {
    const chatEl = document.getElementById('chat');
    chatEl.scrollTop += messageTopOffset(element) - READ_MARGIN;
}

function onReadGenerationStarted(type, _options, dryRun) {
    if (dryRun || type === 'quiet' || type === 'impersonate') return;
    reading.active = !!getSettings().readFromTop && type !== 'continue';
    reading.streamed = false;
    reading.pinnedAt = 0;
}

function onReadStreamToken() {
    if (!reading.active) return;
    reading.streamed = true;
    const element = document.querySelector('#chat .mes.last_mes');
    if (!element) return;

    if (!reading.pinnedAt) {
        if (messageTopOffset(element) < READ_MARGIN) {
            pinMessageTop(element);
            reading.pinnedAt = Date.now();
        }
        return;
    }
    // 고정 직후엔 ST가 미리 예약해 둔 '맨 아래로'가 한 번 더 올 수 있다.
    // 잠깐 동안, 그것도 맨 아래로 끌려갔을 때만 다시 맞춘다(사용자가 내리는 건 막지 않게).
    const chatEl = document.getElementById('chat');
    const atBottom = chatEl.scrollHeight - chatEl.clientHeight - chatEl.scrollTop < 5;
    if (Date.now() - reading.pinnedAt < 1500 && atBottom && messageTopOffset(element) < READ_MARGIN) {
        pinMessageTop(element);
    }
}

function onReadMessageRendered(messageId) {
    if (!reading.active) return;
    reading.active = false;
    if (reading.streamed) return; // 스트리밍은 받는 동안 처리했다
    // ST가 맨 아래로 내린 다음에 올린다
    setTimeout(() => {
        const element = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (element && messageTopOffset(element) < READ_MARGIN) pinMessageTop(element);
    }, 150);
}

// ---------- 읽던 위치 이어 보기 · 현재 위치 표시 (설정에서 켬) ----------
// 읽던 위치는 이 기기 브라우저(localStorage)에만 둔다. 채팅 파일에 두면 스크롤할 때마다
// 채팅 전체를 다시 저장하게 되고, 폰과 PC에서 읽던 곳이 서로 다른 게 자연스럽기도 하다.

const POS_PREFIX = 'chatnav_pos:';

/** 화면 맨 위에 걸쳐 보이는 메시지 번호. 없으면 -1 */
function topVisibleIndex() {
    const chatEl = document.getElementById('chat');
    const top = chatEl.getBoundingClientRect().top;
    for (const element of chatEl.querySelectorAll('.mes')) {
        if (element.getBoundingClientRect().bottom > top + 8) return Number(element.getAttribute('mesid'));
    }
    return -1;
}

function isChatAtBottom() {
    const chatEl = document.getElementById('chat');
    return chatEl.scrollHeight - chatEl.clientHeight - chatEl.scrollTop < 5;
}

function positionKey() {
    const c = ctx();
    const chatId = c.getCurrentChatId?.();
    if (!chatId) return null;
    const owner = c.groupId || c.characters?.[c.characterId]?.avatar || '';
    return POS_PREFIX + owner + ':' + chatId;
}

function readPosition(key) {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
        return null;
    }
}

function writePosition(key, value) {
    try {
        if (value) localStorage.setItem(key, JSON.stringify(value));
        else localStorage.removeItem(key);
    } catch {
        // 사생활 보호 모드 등에서 막혀도 기능만 빠질 뿐 문제없다
    }
}

let positionMuteUntil = 0;
let positionSaveTimer = 0;

/** 채팅 전환 직후 ST가 맨 아래로 내리는 스크롤은 '읽던 곳'으로 치지 않는다 */
function mutePositionSaving(ms) {
    positionMuteUntil = Date.now() + ms;
}

function savePositionNow() {
    if (!getSettings().resumePos || Date.now() < positionMuteUntil) return;
    const key = positionKey();
    if (!key) return;
    if (isChatAtBottom()) {
        writePosition(key, null); // 맨 아래면 따로 기억할 게 없다
        return;
    }
    const index = topVisibleIndex();
    const message = ctx().chat[index];
    if (!message) return;
    writePosition(key, { index, date: message.send_date ?? null });
}

/** 저장된 위치를 지금 채팅의 번호로. 그 사이 메시지가 지워졌으면 보낸 시각으로 다시 찾는다 */
function resolvePosition(saved) {
    const chat = ctx().chat;
    if (!saved || !Number.isInteger(saved.index)) return -1;
    if (chat[saved.index] && (saved.date == null || chat[saved.index].send_date === saved.date)) return saved.index;
    if (saved.date != null) {
        const found = chat.findIndex(m => m?.send_date === saved.date);
        if (found >= 0) return found;
    }
    return -1;
}

let resumeChip = null;
let resumeTimer = 0;

function hideResumeChip() {
    clearTimeout(resumeTimer);
    resumeChip?.remove();
    resumeChip = null;
}

/** 떠 있는 버튼이 있으면 그 위에, 없으면 채팅 아래 끝에 붙는 위치(px) */
function bottomStackOffset() {
    const chatEl = document.getElementById('chat');
    const sheld = document.getElementById('sheld');
    const below = Math.max(0, sheld.getBoundingClientRect().bottom - chatEl.getBoundingClientRect().bottom);
    const pillShown = floating && !floating.classList.contains('chatnav_hidden');
    return below + 12 + (pillShown ? 44 + 8 : 0);
}

function showResumeChip(index) {
    hideResumeChip();
    const sheld = document.getElementById('sheld');
    resumeChip = document.createElement('div');
    resumeChip.id = 'chatnav_resume';
    resumeChip.innerHTML = `
        <button type="button" class="chatnav_resume_go"><i class="fa-solid fa-book-open"></i>읽던 곳 #${index} 이어 보기</button>
        <button type="button" class="chatnav_resume_close" title="닫기" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
    `;
    resumeChip.style.bottom = `${bottomStackOffset()}px`;
    resumeChip.querySelector('.chatnav_resume_go').addEventListener('click', async () => {
        hideResumeChip();
        if (!await confirmFarJump(index)) return;
        await jumpTo(index);
    });
    resumeChip.querySelector('.chatnav_resume_close').addEventListener('click', hideResumeChip);
    sheld.append(resumeChip);
    // 오래 남아 있으면 거슬리니 잠시 뒤 사라진다
    resumeTimer = setTimeout(hideResumeChip, 15000);
}

function onPositionChatChanged() {
    hideResumeChip();
    // ST가 채팅을 그리며 맨 아래로 내리는 동안은 저장하지 않는다
    mutePositionSaving(2000);
    if (!getSettings().resumePos) return;
    const key = positionKey();
    if (!key) return;
    const saved = readPosition(key);
    setTimeout(() => {
        if (positionKey() !== key) return; // 그새 다른 채팅으로 갔다
        const index = resolvePosition(saved);
        const last = ctx().chat.length - 1;
        if (index < 0 || index >= last) return;
        showResumeChip(index);
    }, 400);
}

let positionBadge = null;
let positionBadgeTimer = 0;

function showPositionBadge() {
    // 시작 화면도 #chat에 메시지(안내·어시스턴트 인사)를 그리지만 열린 채팅은 아니다
    if (!ctx().getCurrentChatId?.()) return;
    const chatEl = document.getElementById('chat');
    const sheld = document.getElementById('sheld');
    const index = topVisibleIndex();
    const last = ctx().chat.length - 1;
    if (index < 0 || last < 1) return;
    if (!positionBadge) {
        positionBadge = document.createElement('div');
        positionBadge.id = 'chatnav_position';
        positionBadge.setAttribute('aria-hidden', 'true');
        sheld.append(positionBadge);
    }
    positionBadge.style.top = `${chatEl.getBoundingClientRect().top - sheld.getBoundingClientRect().top + 8}px`;
    positionBadge.textContent = `#${index} / #${last}`;
    positionBadge.classList.add('chatnav_shown');
    clearTimeout(positionBadgeTimer);
    positionBadgeTimer = setTimeout(() => positionBadge?.classList.remove('chatnav_shown'), 1200);
}

function onPositionScroll() {
    // 채팅을 여는 동안 ST가 내리는 스크롤에는 위치 표시도 띄우지 않는다
    if (Date.now() < positionMuteUntil) return;
    if (getSettings().showPos) showPositionBadge();
    if (getSettings().resumePos) {
        clearTimeout(positionSaveTimer);
        positionSaveTimer = setTimeout(savePositionNow, 500);
    }
}

function setupPosition() {
    document.getElementById('chat').addEventListener('scroll', onPositionScroll, { passive: true });
    // 폰에서 앱을 내리거나 탭을 닫을 때도 마지막 위치를 남긴다
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') savePositionNow();
    });
}

// ---------- UI ----------

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;

    const container = document.createElement('div');
    container.id = 'chatnav_wand_container';
    container.className = 'extension_container';
    container.innerHTML = `
        <div id="chatnav_hub_button" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-compass extensionsMenuExtensionButton"></div>
            채팅 내비게이터
        </div>
    `;
    menu.append(container);
    container.querySelector('#chatnav_hub_button').addEventListener('click', openHub);
}

function addSettingsPanel() {
    const s = getSettings();
    const html = `
        <div class="chatnav_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Chat Navigator</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_resume_pos">
                        <span>읽던 위치 이어 보기</span>
                    </label>
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_show_pos">
                        <span>스크롤할 때 현재 위치 표시</span>
                    </label>
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_read_top">
                        <span>답변이 오면 처음 부분에서 멈추기</span>
                    </label>
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_float_bottom">
                        <span>맨 아래로 버튼 띄우기</span>
                    </label>
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_float_top">
                        <span>맨 위로 버튼 띄우기</span>
                    </label>
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_turn_alert">
                        <span>턴 알림</span>
                        <input type="number" id="chatnav_turn_every" class="text_pole" min="1" step="1">
                        <span>턴마다</span>
                    </label>
                    <label class="checkbox_label chatnav_row">
                        <input type="checkbox" id="chatnav_token_alert">
                        <span>토큰 알림</span>
                        <input type="number" id="chatnav_token_every" class="text_pole" min="100" step="1000">
                        <span>토큰마다</span>
                    </label>
                    <small>턴은 AI 답변 수, 토큰은 채팅 전체 기준입니다. 현재 토크나이저로 세고, 숨긴 메시지는 뺍니다.</small>
                </div>
            </div>
        </div>
    `;
    $('#extensions_settings2').append(html);

    const save = () => ctx().saveSettingsDebounced();
    const bindNumber = (id, key, min) => {
        $(id).val(s[key]).on('change', function () {
            const value = Math.max(min, Math.floor(Number($(this).val()) || min));
            s[key] = value;
            $(this).val(value);
            // 간격이 바뀌면 기준을 다시 잡는다
            const meta = getMeta();
            if (meta) delete meta[key === 'turnEvery' ? 'turnBucket' : 'tokenBucket'];
            save();
            checkAlerts();
        });
    };
    const bindCheck = (id, key) => {
        $(id).prop('checked', s[key]).on('change', function () {
            s[key] = $(this).prop('checked');
            save();
            checkAlerts();
        });
    };

    const bindFloat = (id, key) => {
        $(id).prop('checked', s[key]).on('change', function () {
            s[key] = $(this).prop('checked');
            save();
            setFloating(s.floatTop || s.floatBottom);
        });
    };
    const bindPlain = (id, key, after) => {
        $(id).prop('checked', s[key]).on('change', function () {
            s[key] = $(this).prop('checked');
            save();
            after?.(s[key]);
        });
    };
    bindPlain('#chatnav_read_top', 'readFromTop');
    bindPlain('#chatnav_show_pos', 'showPos');
    bindPlain('#chatnav_resume_pos', 'resumePos', (on) => {
        if (on) savePositionNow();
        else hideResumeChip();
    });
    bindFloat('#chatnav_float_bottom', 'floatBottom');
    bindFloat('#chatnav_float_top', 'floatTop');
    bindCheck('#chatnav_turn_alert', 'turnAlert');
    bindCheck('#chatnav_token_alert', 'tokenAlert');
    bindNumber('#chatnav_turn_every', 'turnEvery', 1);
    bindNumber('#chatnav_token_every', 'tokenEvery', 100);
}

jQuery(() => {
    getSettings();
    addWandButton();
    addBookmarkButtons();
    addSettingsPanel();
    setFloating(getSettings().floatTop || getSettings().floatBottom);
    setupPosition();

    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        onPositionChatChanged();
        exitSelectMode();
        tokenCache.clear();
        checkAlerts();
    });
    // 답변 생성이 시작되면 끝낸다. 메시지 삭제 뒤 ST가 돌리는 dry run이나
    // 백그라운드(quiet) 생성은 채팅을 바꾸지 않으니 무시한다.
    eventSource.on(eventTypes.GENERATION_STARTED, onReadGenerationStarted);
    eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, onReadStreamToken);
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, onReadMessageRendered);
    eventSource.on(eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun || type === 'quiet') return;
        exitSelectMode();
    });
    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => checkAlerts());
    eventSource.on(eventTypes.MESSAGE_SENT, () => checkAlerts({ turns: false }));
    eventSource.on(eventTypes.MESSAGE_DELETED, () => checkAlerts());
});
