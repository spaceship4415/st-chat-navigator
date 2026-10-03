// 채팅 내비게이터: 마법봉 메뉴 하나로 현재 채팅 검색, 번호로 이동, 책갈피, 범위 숨기기·삭제, 골라서 숨기기·삭제, 맨 위/아래.
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
const BOOKMARK_BUTTON = '<div title="책갈피" class="mes_button chatnav_bookmark_button fa-regular fa-star"></div>';

function isBookmarked(message) {
    return !!message?.extra?.[BOOKMARK_KEY];
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
    else delete message.extra[BOOKMARK_KEY];
    paintBookmarks();
    await ctx().saveChat();
}

/** 화면에 그려진 메시지에 책갈피 표시(이름 옆 별, 버튼 채움)를 맞춘다. */
function paintBookmarks() {
    const chat = ctx().chat;
    for (const element of document.querySelectorAll('#chat .mes')) {
        const on = isBookmarked(chat[Number(element.getAttribute('mesid'))]);
        element.classList.toggle('chatnav_bookmarked', on);
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


    // 채팅 전환·이전 메시지 불러오기 등으로 메시지가 다시 그려지면 표시를 맞춘다.
    // requestAnimationFrame은 백그라운드 탭에서 멈추므로 타이머를 쓴다.
    let timer = 0;
    new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            paintBookmarks();
            paintSelection();
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
                    메시지의 <i class="fa-solid fa-ellipsis"></i> 메뉴에서 <i class="fa-regular fa-star"></i>를 누르면 추가됩니다.
                </div>`;
            return;
        }
        for (const index of indices) {
            const message = chat[index];
            const row = document.createElement('div');
            row.className = 'chatnav_bookmark_row';
            row.innerHTML = `
                <button type="button" class="chatnav_item">
                    <span class="chatnav_meta"><b>#${index}</b> ${escapeHtml(message?.name)}</span>
                    <span class="chatnav_snippet">${plainSnippet(message?.mes)}</span>
                </button>
                <button type="button" class="chatnav_remove fa-solid fa-xmark" title="책갈피 빼기" aria-label="책갈피 빼기"></button>
            `;
            row.querySelector('.chatnav_item').addEventListener('click', () => pick(index));
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
        const result = await callGenericPopup(`
            <div class="chatnav_popup chatnav_mark_warn">
                <h3><i class="fa-solid fa-star"></i> 책갈피한 메시지 ${marked.length}개가 포함되어 있습니다</h3>
                <ul>${items}</ul>${more}
                <p>책갈피한 메시지는 남기고 나머지만 지울까요?</p>
            </div>`, POPUP_TYPE.CONFIRM, '', {
            okButton: '책갈피 빼고 삭제',
            cancelButton: '취소',
            customButtons: [{ text: '모두 삭제', result: DELETE_ALL, classes: ['chatnav_danger_button'] }],
        });
        if (result === POPUP_RESULT.AFFIRMATIVE) {
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

// ---------- 메뉴판 ----------

async function openHub() {
    if (!hasChat()) return;
    exitSelectMode();
    const { Popup, POPUP_TYPE, chat } = ctx();

    const items = [
        { icon: 'fa-magnifying-glass', label: '채팅 검색', run: openSearchPopup, wide: true },
        { icon: 'fa-arrow-down-1-9', label: '번호로 이동', run: openJumpPopup },
        { icon: 'fa-star', label: `책갈피 (${bookmarkedIndices().length})`, run: openBookmarksPopup },
        { icon: 'fa-eye-slash', label: '범위 숨기기', run: openHidePopup },
        { icon: 'fa-trash-can', label: '범위 삭제', run: openDeletePopup, danger: true },
        { icon: 'fa-list-check', label: '골라서 숨기기·삭제', run: enterSelectMode, wide: true },
        { icon: 'fa-angles-up', label: '맨 위로', run: goTop },
        { icon: 'fa-angles-down', label: '맨 아래로', run: goBottom },
    ];

    const root = document.createElement('div');
    root.className = 'chatnav_hub';
    root.innerHTML = `
        <h3>채팅 내비게이터</h3>
        <div class="chatnav_hint">메시지 ${chat.length.toLocaleString()}개 (#0 ~ #${Math.max(0, chat.length - 1)})</div>
        <div class="chatnav_hub_grid"></div>
    `;
    const grid = root.querySelector('.chatnav_hub_grid');
    const popup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: '닫기' });

    for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chatnav_hub_button';
        if (item.wide) button.classList.add('chatnav_hub_wide');
        if (item.danger) button.classList.add('chatnav_hub_danger');
        button.innerHTML = `<i class="fa-solid ${item.icon}"></i><span>${escapeHtml(item.label)}</span>`;
        button.addEventListener('click', async () => {
            await popup.completeCancelled();
            await item.run();
        });
        grid.append(button);
    }

    await popup.show();
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

    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        exitSelectMode();
        tokenCache.clear();
        checkAlerts();
    });
    // 답변 생성이 시작되면 끝낸다. 메시지 삭제 뒤 ST가 돌리는 dry run이나
    // 백그라운드(quiet) 생성은 채팅을 바꾸지 않으니 무시한다.
    eventSource.on(eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun || type === 'quiet') return;
        exitSelectMode();
    });
    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => checkAlerts());
    eventSource.on(eventTypes.MESSAGE_SENT, () => checkAlerts({ turns: false }));
    eventSource.on(eventTypes.MESSAGE_DELETED, () => checkAlerts());
});
