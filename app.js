/* Состояние хранится только в браузере: сервер и база данных не требуются. */
const STORAGE_KEY = 'lucky-barrel-state-v1';
const defaultState = {
  participants: [],
  history: [],
  excludedPeople: [],
  usedTickets: []
};

let state = loadState();
let activeRound = null;
let drawing = false;

const elements = {
  form: document.querySelector('#participantForm'),
  name: document.querySelector('#participantName'),
  tickets: document.querySelector('#participantTickets'),
  present: document.querySelector('#participantPresent'),
  list: document.querySelector('#participantList'),
  empty: document.querySelector('#emptyState'),
  peopleCount: document.querySelector('#peopleCount'),
  ticketCount: document.querySelector('#ticketCount'),
  presentCount: document.querySelector('#presentCount'),
  prizeName: document.querySelector('#prizeName'),
  blankCount: document.querySelector('#blankCount'),
  winnerPolicy: document.querySelector('#winnerPolicy'),
  drawButton: document.querySelector('#drawButton'),
  poolInfo: document.querySelector('#poolInfo'),
  barrel: document.querySelector('#barrel'),
  wheelLabels: document.querySelector('#wheelLabels'),
  barrelSymbol: document.querySelector('#barrelSymbol'),
  stage: document.querySelector('#barrelStage'),
  stageKicker: document.querySelector('#stageKicker'),
  stageTitle: document.querySelector('#stageTitle'),
  stageText: document.querySelector('#stageText'),
  historyList: document.querySelector('#historyList'),
  historyEmpty: document.querySelector('#historyEmpty'),
  bulkInput: document.querySelector('#bulkInput'),
  toast: document.querySelector('#toast')
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.participants)
      ? { ...defaultState, ...saved }
      : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/* Криптографический генератор убирает систематическую погрешность Math.random. */
function secureIndex(length) {
  if (length <= 1) return 0;
  const max = Math.floor(0x100000000 / length) * length;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= max);
  return value[0] % length;
}

function selectedAudience() {
  return document.querySelector('input[name="audience"]:checked').value;
}

function addParticipant(name, tickets, present = true) {
  const cleanName = name.trim();
  const cleanTickets = Math.max(1, Math.min(999, Number(tickets) || 1));
  if (!cleanName) return false;
  state.participants.push({ id: makeId(), name: cleanName, tickets: cleanTickets, present: Boolean(present) });
  resetRound(false);
  saveState();
  render();
  return true;
}

function participantTokens() {
  const audience = selectedAudience();
  const excluded = new Set(state.excludedPeople);
  const used = new Set(state.usedTickets);
  const tokens = [];

  state.participants.forEach((person) => {
    if (audience === 'present' && !person.present) return;
    if (excluded.has(person.id)) return;
    for (let number = 1; number <= person.tickets; number += 1) {
      const ticketKey = `${person.id}:${number}`;
      if (!used.has(ticketKey)) tokens.push({ type: 'ticket', personId: person.id, number, ticketKey });
    }
  });
  return tokens;
}

function roundSignature() {
  return JSON.stringify({
    participants: state.participants,
    audience: selectedAudience(),
    blanks: Number(elements.blankCount.value) || 0,
    excluded: state.excludedPeople,
    used: state.usedTickets
  });
}

function startOrContinueRound() {
  const signature = roundSignature();
  if (activeRound?.signature === signature && activeRound.tokens.length) return activeRound;

  const tokens = participantTokens();
  const blankCount = Math.max(0, Math.min(100, Number(elements.blankCount.value) || 0));
  for (let index = 0; index < blankCount; index += 1) tokens.push({ type: 'blank', id: index });
  activeRound = { signature, tokens };
  return activeRound;
}

/* Рулетка показывает долю каждого участника пропорционально числу его билетов. */
function buildWheelLayout(tokens) {
  const palette = ['#ff5bae', '#23d8e7', '#ff8a3d', '#7864ff', '#ffd66b', '#7ee081', '#ff719a', '#41a9ff'];
  const groups = new Map();

  tokens.forEach((token) => {
    const key = token.type === 'blank' ? 'blank' : token.personId;
    if (!groups.has(key)) {
      const person = state.participants.find((item) => item.id === token.personId);
      groups.set(key, {
        key,
        label: token.type === 'blank' ? 'ПУСТО' : (person?.name || 'Билет'),
        color: token.type === 'blank' ? '#4a456b' : palette[groups.size % palette.length],
        count: 0
      });
    }
    groups.get(key).count += 1;
  });

  const total = Math.max(tokens.length, 1);
  let cursor = 0;
  return [...groups.values()].map((group) => {
    const start = cursor / total * 360;
    cursor += group.count;
    const end = cursor / total * 360;
    return { ...group, start, end, middle: (start + end) / 2 };
  });
}

function renderWheel(tokens) {
  const layout = buildWheelLayout(tokens);
  elements.barrel.style.transition = 'none';
  elements.barrel.style.transform = 'rotate(0deg)';
  elements.barrel.classList.remove('spinning');

  if (!layout.length) {
    elements.barrel.style.background = 'conic-gradient(#272354 0 45deg, #151438 45deg 90deg, #272354 90deg 135deg, #151438 135deg 180deg, #272354 180deg 225deg, #151438 225deg 270deg, #272354 270deg 315deg, #151438 315deg 360deg)';
  } else {
    const sectors = layout.map((group) => `${group.color} ${group.start}deg ${Math.max(group.start, group.end - 1.4)}deg, #09091e ${Math.max(group.start, group.end - 1.4)}deg ${group.end}deg`);
    elements.barrel.style.background = `conic-gradient(${sectors.join(', ')})`;
  }

  elements.wheelLabels.replaceChildren(...layout
    .filter((group) => layout.length <= 12 && group.end - group.start >= 16)
    .map((group) => {
      const label = document.createElement('span');
      label.className = 'wheel-label';
      label.textContent = group.label.length > 10 ? `${group.label.slice(0, 9)}…` : group.label;
      label.style.setProperty('--angle', `${group.middle}deg`);
      return label;
    }));
}

async function spinWheel(tokens, tokenIndex) {
  renderWheel(tokens);
  elements.barrelSymbol.textContent = '✦';
  void elements.barrel.offsetWidth;

  const sectorAngle = (tokenIndex + .5) / tokens.length * 360;
  const turns = 6 + secureIndex(3);
  const rotation = turns * 360 - sectorAngle;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reducedMotion ? 450 : 4200 + secureIndex(600);
  elements.barrel.style.transition = `transform ${duration}ms cubic-bezier(.12, .68, .08, 1)`;
  elements.barrel.style.transform = `rotate(${rotation}deg)`;
  elements.barrel.classList.add('spinning');

  if (!reducedMotion) {
    [250, 700, 1300, 2100, 3000, 3700].forEach((delay, index) => {
      setTimeout(() => softSound(460 - index * 35, .045), delay);
    });
  }
  await wait(duration + 120);
  elements.barrel.classList.remove('spinning');
}

function resetRound(showMessage = true) {
  activeRound = null;
  elements.stage.className = 'barrel-stage';
  elements.barrelSymbol.textContent = '?';
  elements.drawButton.querySelector('span').textContent = 'Запустить рулетку';
  elements.stageKicker.textContent = 'Рулетка готова';
  elements.stageTitle.textContent = 'Кто сегодня счастливчик?';
  elements.stageText.textContent = 'Настройте розыгрыш и запустите колесо';
  const previewTokens = participantTokens();
  const blankCount = Math.max(0, Math.min(100, Number(elements.blankCount.value) || 0));
  if (previewTokens.length) {
    for (let index = 0; index < blankCount; index += 1) previewTokens.push({ type: 'blank', id: index });
  }
  renderWheel(previewTokens);
  if (showMessage) toast('Рулетка перемешана');
  updatePoolInfo();
}

function updatePoolInfo() {
  const count = participantTokens().length;
  elements.drawButton.disabled = drawing || count === 0;
  elements.poolInfo.textContent = count
    ? `${count} ${wordForm(count, ['билет', 'билета', 'билетов'])} участвует`
    : 'Нет подходящих билетов';
}

function wordForm(number, forms) {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function setDrawing(isDrawing, buttonText = 'Запустить рулетку') {
  drawing = isDrawing;
  elements.drawButton.disabled = isDrawing || participantTokens().length === 0;
  elements.drawButton.querySelector('span').textContent = isDrawing ? 'Рулетка крутится…' : buttonText;
}

async function draw() {
  if (drawing) return;
  const round = startOrContinueRound();
  const realTickets = round.tokens.filter((token) => token.type === 'ticket');
  if (!realTickets.length) {
    resetRound(false);
    toast('В рулетке не осталось билетов');
    return;
  }

  const tokenIndex = secureIndex(round.tokens.length);
  const token = round.tokens[tokenIndex];
  setDrawing(true);
  elements.stage.className = 'barrel-stage';
  elements.stageKicker.textContent = 'Колесо запущено';
  elements.stageTitle.textContent = 'Ловим удачу…';
  elements.stageText.textContent = 'Стрелка уже выбирает сектор';
  tickSound();
  await spinWheel(round.tokens, tokenIndex);

  round.tokens.splice(tokenIndex, 1);
  if (token.type === 'blank') {
    showBlank(round);
    setDrawing(false, 'Крутить ещё раз');
  } else {
    showWinner(token);
    setDrawing(false);
  }
  updatePoolInfo();
}

function showBlank(round) {
  elements.stage.className = 'barrel-stage blank';
  elements.barrelSymbol.textContent = '—';
  elements.stageKicker.textContent = 'Пустой сектор';
  elements.stageTitle.textContent = 'Пока без победителя';
  elements.stageText.textContent = `Осталось пустых: ${round.tokens.filter((item) => item.type === 'blank').length}`;
  softSound(180, .08);
}

function showWinner(token) {
  const person = state.participants.find((item) => item.id === token.personId);
  if (!person) return resetRound(false);
  const prize = elements.prizeName.value.trim() || 'Приз';
  const policy = elements.winnerPolicy.value;

  if (policy === 'person' && !state.excludedPeople.includes(person.id)) state.excludedPeople.push(person.id);
  if (policy === 'ticket' && !state.usedTickets.includes(token.ticketKey)) state.usedTickets.push(token.ticketKey);

  state.history.unshift({
    id: makeId(),
    prize,
    personName: person.name,
    ticketNumber: token.number,
    audience: selectedAudience(),
    time: new Date().toISOString()
  });
  activeRound = null;
  saveState();

  elements.stage.className = 'barrel-stage winner';
  elements.barrelSymbol.textContent = token.number;
  elements.stageKicker.textContent = 'Есть победитель!';
  elements.stageTitle.textContent = person.name;
  elements.stageText.textContent = `${prize} · билет № ${token.number}`;
  victorySound();
  render();
}

function render() {
  const totalTickets = state.participants.reduce((sum, person) => sum + person.tickets, 0);
  elements.peopleCount.textContent = state.participants.length;
  elements.ticketCount.textContent = totalTickets;
  elements.presentCount.textContent = state.participants.filter((person) => person.present).length;
  elements.empty.hidden = state.participants.length > 0;

  elements.list.replaceChildren(...state.participants.map((person) => {
    const card = document.createElement('div');
    card.className = 'participant-card';
    card.innerHTML = `
      <span class="avatar">${escapeHtml(person.name.charAt(0).toUpperCase())}</span>
      <span><strong>${escapeHtml(person.name)}</strong><small>${person.tickets} ${wordForm(person.tickets, ['билет', 'билета', 'билетов'])}</small></span>
      <label class="attendance-toggle"><input type="checkbox" ${person.present ? 'checked' : ''}><span>${person.present ? 'пришёл' : 'не пришёл'}</span></label>
      <button class="remove-button" type="button" title="Удалить участника" aria-label="Удалить ${escapeHtml(person.name)}">×</button>`;
    card.querySelector('input').addEventListener('change', (event) => {
      person.present = event.target.checked;
      resetRound(false); saveState(); render();
    });
    card.querySelector('button').addEventListener('click', () => {
      state.participants = state.participants.filter((item) => item.id !== person.id);
      state.excludedPeople = state.excludedPeople.filter((id) => id !== person.id);
      state.usedTickets = state.usedTickets.filter((key) => !key.startsWith(`${person.id}:`));
      resetRound(false); saveState(); render();
    });
    return card;
  }));

  elements.historyEmpty.hidden = state.history.length > 0;
  elements.historyList.replaceChildren(...state.history.map((result, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const date = new Date(result.time);
    item.innerHTML = `
      <span class="history-number">${state.history.length - index}</span>
      <span><strong>${escapeHtml(result.personName)}</strong><small>${escapeHtml(result.prize)} · билет № ${result.ticketNumber}</small></span>
      <span class="history-meta">${result.audience === 'present' ? 'среди пришедших' : 'среди всех'}<br>${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>`;
    return item;
  }));
  updatePoolInfo();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

/* Короткие сигналы создаются браузером и не требуют аудиофайлов. */
function softSound(frequency, duration) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.05, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + duration);
  } catch { /* Звук необязателен для работы розыгрыша. */ }
}
function tickSound() { softSound(320, .12); }
function victorySound() { softSound(660, .32); setTimeout(() => softSound(880, .38), 140); }

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (addParticipant(elements.name.value, elements.tickets.value, elements.present.checked)) {
    elements.name.value = '';
    elements.tickets.value = '1';
    elements.name.focus();
  }
});

document.querySelector('#bulkButton').addEventListener('click', () => {
  let added = 0;
  elements.bulkInput.value.split(/\r?\n/).forEach((line) => {
    const [name = '', tickets = '1', attendance = 'да'] = line.split(';').map((part) => part.trim());
    if (addParticipant(name, tickets, !/^(нет|no|0)$/i.test(attendance))) added += 1;
  });
  elements.bulkInput.value = '';
  toast(added ? `Добавлено участников: ${added}` : 'Не удалось распознать список');
});

document.querySelector('#demoButton').addEventListener('click', () => {
  if (state.participants.length && !confirm('Заменить текущий список демонстрационным?')) return;
  state = structuredClone(defaultState);
  [['Анна', 5, true], ['Михаил', 5, true], ['Елена', 5, true], ['Сергей', 5, true], ['Ольга', 5, true], ['Виктор', 1, false], ['Ирина', 1, true], ['Павел', 1, false]].forEach(([name, tickets, present]) => {
    state.participants.push({ id: makeId(), name, tickets, present });
  });
  resetRound(false); saveState(); render(); toast('Демонстрационный список загружен');
});

document.querySelector('#clearButton').addEventListener('click', () => {
  if (!state.participants.length || !confirm('Удалить всех участников и результаты?')) return;
  state = structuredClone(defaultState);
  resetRound(false); saveState(); render();
});

document.querySelector('#clearHistoryButton').addEventListener('click', () => {
  if (!state.history.length) return;
  state.history = [];
  state.excludedPeople = [];
  state.usedTickets = [];
  resetRound(false); saveState(); render(); toast('История и ограничения сброшены');
});

elements.drawButton.addEventListener('click', draw);
document.querySelector('#resetRoundButton').addEventListener('click', () => resetRound(true));
document.querySelectorAll('input[name="audience"]').forEach((input) => input.addEventListener('change', () => resetRound(false)));
elements.blankCount.addEventListener('change', () => resetRound(false));

render();
resetRound(false);
