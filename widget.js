const defaultTheme = "snow";

const toolbarOptions = [
  ['bold', 'italic', 'underline', 'strike', { script: 'sub' }, { script: 'super' }, { color: [] }, { background: [] }, { align: [] }, 'blockquote', 'code-block', { list: 'ordered' }, { list: 'bullet' }, { list: 'check' }, 'link', 'image', 'formula'],
  [{ header: [1, 2, 3, 4, 5, 6, false] }, { size: ['small', false, 'large', 'huge'] }],
  ['clean'],
];

let quill = null;

let id = null;
let column = null;
let columnText = null;
let user = null;
let lastContent = [];
let culture = 'en-US';
let editingIndex = null;
let currentMappedRecord = null;
let currentRecordRaw = null;
let editorToolbarVisible = false;
let currentTheme = defaultTheme;

localize();
const table = grist.getTable();

function getLang() {
  return (culture || 'en-US').split('-')[0];
}

function t(key) {
  const lang = getLang();
  const dict = {
    fr: {
      messages: 'Messages',
      newMessage: 'Nouveau message',
      editMessage: 'Modifier le message',
      send: 'Envoyer',
      cancel: 'Annuler',
      toggleToolbar: 'Afficher / masquer la barre de mise en forme',
      unknownAuthor: 'Auteur inconnu',
      open: 'Ouvert',
      resolved: 'Résolu',
      noMessages: 'Aucun message pour le moment.',
      edit: 'Modifier',
      resolve: 'Résoudre',
      reopen: 'Rouvrir',
      delete: 'Supprimer',
      placeholder: 'Écrire un message...'
    },
    es: {
      messages: 'Mensajes',
      newMessage: 'Nuevo mensaje',
      editMessage: 'Editar mensaje',
      send: 'Enviar',
      cancel: 'Cancelar',
      toggleToolbar: 'Mostrar / ocultar la barra de formato',
      unknownAuthor: 'Autor desconocido',
      open: 'Abierto',
      resolved: 'Resuelto',
      noMessages: 'No hay mensajes por el momento.',
      edit: 'Editar',
      resolve: 'Resolver',
      reopen: 'Reabrir',
      delete: 'Eliminar',
      placeholder: 'Escriba un mensaje...'
    },
    en: {
      messages: 'Messages',
      newMessage: 'New message',
      editMessage: 'Edit message',
      send: 'Send',
      cancel: 'Cancel',
      toggleToolbar: 'Show / hide formatting toolbar',
      unknownAuthor: 'Unknown author',
      open: 'Open',
      resolved: 'Resolved',
      noMessages: 'No messages yet.',
      edit: 'Edit',
      resolve: 'Resolve',
      reopen: 'Reopen',
      delete: 'Delete',
      placeholder: 'Write a message...'
    }
  };

  return (dict[lang] || dict.en)[key] || key;
}

function localize() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('culture')) culture = urlParams.get('culture');

  const messagesTitle = document.getElementById('messages-title');
  const composerPanelTitle = document.getElementById('composer-panel-title');
  const newTitle = document.getElementById('new-title');
  const send = document.getElementById('send');
  const cancel = document.getElementById('cancel-edit');
  const toggle = document.getElementById('toolbar-toggle');

  if (messagesTitle) messagesTitle.textContent = t('messages');
  if (composerPanelTitle) composerPanelTitle.textContent = t('newMessage');
  if (newTitle && editingIndex === null) newTitle.textContent = t('newMessage');
  if (send) send.textContent = t('send');
  if (cancel) cancel.textContent = t('cancel');
  if (toggle) toggle.title = t('toggleToolbar');
}

function Datereviver(key, value) {
  if (typeof value === 'string') {
    const date = Date.parse(value);
    if (!isNaN(date)) return new Date(date);
  }
  return value;
}

function normalizeDate(value) {
  if (!value) return new Date(0);
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function htmlToPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function extractDisplayValue(value) {
  if (value == null) return '';

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return value.map(v => extractDisplayValue(v)).filter(Boolean).join(', ').trim();
  }

  if (typeof value === 'object') {
    const candidates = [
      value.displayValue,
      value.display,
      value.name,
      value.label,
      value.fullName,
      value.email,
      value.title
    ];
    for (const c of candidates) {
      const out = extractDisplayValue(c);
      if (out) return out;
    }
  }

  return '';
}

function guessAuthorFromRecord() {
  if (!currentMappedRecord) return '';

  if (user && currentMappedRecord[user] !== undefined) {
    const fromMappedUser = extractDisplayValue(currentMappedRecord[user]);
    if (fromMappedUser) return fromMappedUser;
  }

  if (currentMappedRecord.User !== undefined) {
    const fromUser = extractDisplayValue(currentMappedRecord.User);
    if (fromUser) return fromUser;
  }

  return '';
}

function getStatusLabel(status) {
  return status === 'resolved' ? t('resolved') : t('open');
}

function showPanel(name) {
  const cfg = document.getElementById("configuration");
  const chat = document.getElementById("chat");

  if (cfg) cfg.style.display = 'none';
  if (chat) chat.style.display = 'none';

  if (name) {
    const el = document.getElementById(name);
    if (el) el.style.display = '';
  }
}

function setEditingMode(isEditing) {
  const titleEl = document.getElementById('new-title');
  const panelTitleEl = document.getElementById('composer-panel-title');
  const cancelBtn = document.getElementById('cancel-edit');

  const label = isEditing ? t('editMessage') : t('newMessage');

  if (titleEl) titleEl.textContent = label;
  if (panelTitleEl) panelTitleEl.textContent = label;
  if (cancelBtn) cancelBtn.style.display = isEditing ? '' : 'none';
}

function clearEditor() {
  if (!quill) return;
  quill.setContents([]);
  quill.root.innerHTML = '';
}

function toggleToolbar(forceVisible = null) {
  const shell = document.getElementById('editor-shell');
  if (!shell) return;

  editorToolbarVisible = forceVisible === null ? !editorToolbarVisible : !!forceVisible;

  if (currentTheme === 'plain' || currentTheme === 'bubble') {
    editorToolbarVisible = false;
  }

  shell.classList.toggle('editor-toolbar-hidden', !editorToolbarVisible);
}

function makeQuill(themeOpt) {
  currentTheme = themeOpt || defaultTheme;

  const quillDiv = document.createElement('div');
  quillDiv.id = 'quill';

  const editor = document.getElementById('editor');
  editor.innerHTML = '';
  editor.appendChild(quillDiv);

  const hasToolbar = currentTheme === 'snow';
  const realTheme = currentTheme === 'plain' ? 'snow' : currentTheme;
  const modules = hasToolbar ? { toolbar: toolbarOptions } : {};

  const q = new Quill('#quill', {
    theme: realTheme,
    modules,
    placeholder: t('placeholder')
  });

  const configForm = document.getElementById("configuration");
  if (configForm && !configForm.dataset.bound) {
    configForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      await saveOptions();
    });
    configForm.dataset.bound = "1";
  }

  toggleToolbar(false);
  return q;
}

async function saveOptions() {
  const theme = document.getElementById("quillTheme").value;
  await grist.widgetApi.setOption('quillTheme', theme);
  showPanel('chat');
}

function buildPlainTextLog() {
  if (!lastContent || !Array.isArray(lastContent)) return '';

  const sorted = [...lastContent].sort((a, b) => {
    const da = normalizeDate(a?.[1]);
    const db = normalizeDate(b?.[1]);
    return db - da;
  });

  const lines = [];

  for (const data of sorted) {
    if (!data || data.length < 3) continue;

    const author = (data[0] && String(data[0]).trim()) ? String(data[0]).trim() : t('unknownAuthor');
    const d = normalizeDate(data[1]);
    const plain = htmlToPlainText(data[2] || '');

    const dateStr = d.toLocaleDateString(culture, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit'
    });

    lines.push(`${dateStr} ${author} : ${plain}`);
  }

  return lines.join('\n');
}

function saveMessages() {
  if (!column || !id) return;

  const fields = {};
  fields[column] = JSON.stringify(lastContent);

  if (columnText) {
    fields[columnText] = buildPlainTextLog();
  }

  table.update({ id, fields });
}

grist.ready({
  requiredAccess: 'full',
  columns: [
    { name: 'Messages', type: 'Text' },
    { name: 'User', type: 'Text', optional: true },
    { name: 'MessagesText', type: 'Text', optional: true }
  ],
  onEditOptions() {
    showPanel('configuration');
  },
});

grist.onRecord(function(record, mappings) {
  if (!record) return;

  localize();
  showPanel('chat');
  editingIndex = null;
  setEditingMode(false);

  if (!quill || !quill.enable) return;
  quill.enable();

  const mapped = grist.mapColumnNames(record);
  currentMappedRecord = mapped || {};
  currentRecordRaw = record || {};

  const recordChanged =
    id !== record.id ||
    mappings?.Messages !== column ||
    mappings?.MessagesText !== columnText ||
    mappings?.User !== user;

  if (recordChanged) {
    id = record.id;
    column = mappings?.Messages;
    user = mappings?.User;
    columnText = mappings?.MessagesText;

    if (!mapped) {
      console.error('Please map columns');
      lastContent = [];
      LoadMessages(lastContent);
      return;
    }

    let raw = mapped.Messages;
    if (typeof raw === 'string') {
      raw = raw.replace('|-¤-|', '');
    }

    if (!raw || (typeof raw === 'string' && raw.trim().length === 0)) {
      lastContent = [];
    } else {
      try {
        lastContent = typeof raw === 'string' ? JSON.parse(raw, Datereviver) : raw;
        if (!Array.isArray(lastContent)) lastContent = [];
      } catch (e) {
        console.error('Error parsing Messages JSON', e);
        lastContent = [];
      }
    }

    LoadMessages(lastContent);
  }
});

grist.onNewRecord(function() {
  const container = document.getElementById('msg-container');
  if (container) container.innerHTML = '';

  showPanel('');
  id = null;
  lastContent = [];
  editingIndex = null;
  currentMappedRecord = null;
  currentRecordRaw = null;
  setEditingMode(false);

  if (quill && quill.setContents && quill.disable) {
    quill.setContents([]);
    quill.disable();
  }
});

grist.onOptions((customOptions) => {
  customOptions = customOptions || {};
  const theme = customOptions.quillTheme || defaultTheme;

  const sel = document.getElementById("quillTheme");
  if (sel) sel.value = theme;

  quill = makeQuill(theme);
  localize();
  showPanel("chat");

  const toggleBtn = document.getElementById('toolbar-toggle');
  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.addEventListener('click', () => toggleToolbar());
    toggleBtn.dataset.bound = "1";
  }

  const sendBtn = document.getElementById('send');
  if (sendBtn && !sendBtn.dataset.bound) {
    sendBtn.addEventListener('click', AddNewMessage);
    sendBtn.dataset.bound = "1";
  }

  const cancelBtn = document.getElementById('cancel-edit');
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.addEventListener('click', cancelEditMessage);
    cancelBtn.dataset.bound = "1";
  }
});

function DisplayMessage(index, author, date, message, status) {
  const container = document.getElementById('msg-container');
  if (!container) return;

  const card = document.createElement('div');
  card.className = 'message-card';
  if (status === 'resolved') card.classList.add('resolved');

  const safeAuthor = (author && String(author).trim().length)
    ? String(author).trim()
    : t('unknownAuthor');

  const safeStatus = status === 'resolved' ? 'resolved' : 'open';
  const d = normalizeDate(date);

  const head = document.createElement('div');
  head.className = 'message-head';

  const left = document.createElement('div');
  left.className = 'message-head-left';

  const authorSpan = document.createElement('span');
  authorSpan.className = 'author';
  authorSpan.textContent = safeAuthor;

  const statusSpan = document.createElement('span');
  statusSpan.className = 'status-badge';
  statusSpan.textContent = getStatusLabel(safeStatus);

  left.appendChild(authorSpan);
  left.appendChild(statusSpan);

  const right = document.createElement('div');
  right.className = 'message-head-right';

  const dateSpan = document.createElement('span');
  dateSpan.className = 'date';
  dateSpan.textContent = d.toLocaleString(culture);

  right.appendChild(dateSpan);

  head.appendChild(left);
  head.appendChild(right);

  const body = document.createElement('div');
  body.className = 'message-body';

  const msgDiv = document.createElement('div');
  msgDiv.className = 'card-message';
  msgDiv.innerHTML = message || '';
  body.appendChild(msgDiv);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'msg-btn edit';
  editBtn.type = 'button';
  editBtn.textContent = t('edit');
  editBtn.title = t('edit');
  editBtn.addEventListener('click', () => startEditMessage(index));

  const resolveBtn = document.createElement('button');
  resolveBtn.className = 'msg-btn resolve';
  resolveBtn.type = 'button';
  resolveBtn.textContent = safeStatus === 'resolved' ? t('reopen') : t('resolve');
  resolveBtn.title = resolveBtn.textContent;
  resolveBtn.addEventListener('click', () => toggleResolveMessage(index));

  const delBtn = document.createElement('button');
  delBtn.className = 'msg-btn delete';
  delBtn.type = 'button';
  delBtn.textContent = t('delete');
  delBtn.title = t('delete');
  delBtn.addEventListener('click', () => deleteMessage(index));

  if (safeStatus === 'resolved') {
    editBtn.disabled = true;
    delBtn.disabled = true;
  }

  actions.appendChild(editBtn);
  actions.appendChild(resolveBtn);
  actions.appendChild(delBtn);

  body.appendChild(actions);

  card.appendChild(head);
  card.appendChild(body);

  container.appendChild(card);
}

function LoadMessages(messages) {
  const container = document.getElementById('msg-container');
  if (!container) return;

  container.innerHTML = '';

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = t('noMessages');
    container.appendChild(empty);
    return;
  }

  const indexed = messages
    .map((data, index) => ({ data, index }))
    .filter(item => item.data && item.data.length >= 3)
    .sort((a, b) => {
      const da = normalizeDate(a.data[1]);
      const db = normalizeDate(b.data[1]);
      return db - da;
    });

  for (const item of indexed) {
    const data = item.data;
    DisplayMessage(item.index, data[0], data[1], data[2], data[3] || 'open');
  }
}

function LoadMesssages(messages) {
  LoadMessages(messages);
}

function AddMessage(author, date, message) {
  const status = 'open';
  if (!lastContent || !Array.isArray(lastContent)) {
    lastContent = [];
  }
  lastContent.push([author, date, message, status]);
  saveMessages();
  LoadMessages(lastContent);
}

function startEditMessage(index) {
  if (!lastContent || index < 0 || index >= lastContent.length) return;
  const data = lastContent[index];
  if (!data || data.length < 3) return;

  editingIndex = index;
  const html = data[2] || '';

  if (quill && quill.root) {
    quill.root.innerHTML = html;
  }

  setEditingMode(true);

  const panel = document.querySelector('.composer-body');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function cancelEditMessage() {
  editingIndex = null;
  clearEditor();
  setEditingMode(false);
  localize();
}

function deleteMessage(index) {
  if (!lastContent || index < 0 || index >= lastContent.length) return;
  const data = lastContent[index];
  if (!data) return;

  const status = data[3] || 'open';
  if (status === 'resolved') return;

  lastContent.splice(index, 1);

  if (editingIndex === index) {
    cancelEditMessage();
  } else if (editingIndex !== null && editingIndex > index) {
    editingIndex -= 1;
  }

  saveMessages();
  LoadMessages(lastContent);
}

function toggleResolveMessage(index) {
  if (!lastContent || index < 0 || index >= lastContent.length) return;
  const data = lastContent[index];
  if (!data) return;

  const currentStatus = data[3] || 'open';
  data[3] = currentStatus === 'resolved' ? 'open' : 'resolved';

  saveMessages();
  LoadMessages(lastContent);
}

async function resolveCurrentAuthor() {
  let author = '';

  try {
    const userInfo = await grist.getUser();
    if (userInfo) {
      author =
        extractDisplayValue(userInfo.name) ||
        extractDisplayValue(userInfo.fullName) ||
        extractDisplayValue(userInfo.email);

      if (!author && userInfo.email && typeof userInfo.email === 'string') {
        author = userInfo.email.split('@')[0];
      }
    }
  } catch (e) {
    console.error('Unable to get user info', e);
  }

  if (!author) {
    author = guessAuthorFromRecord();
  }

  if (!author) {
    author = t('unknownAuthor');
  }

  return author;
}

async function AddNewMessage() {
  if (!column || !id || !quill) return;

  const html = quill.getSemanticHTML();
  const plain = htmlToPlainText(html);

  if (!plain) return;

  const date = new Date();
  const author = await resolveCurrentAuthor();

  if (editingIndex !== null) {
    const data = lastContent[editingIndex];
    if (data && data.length >= 3) {
      data[2] = html;
    }
    saveMessages();
    LoadMessages(lastContent);
    cancelEditMessage();
    return;
  }

  AddMessage(author, date, html);
  clearEditor();
  setEditingMode(false);
  localize();
}
