(() => {
  const dialog = el('homeEditor');
  const frame = el('homeFrame');
  const nodeSelector = el('homeNodes');
  const storagePrefix = 'uu-home-edits-2:';
  const editable = ['href', 'src', 'alt', 'title', 'placeholder', 'name', 'value', 'type', 'poster', 'content', 'aria-label', 'class', 'style'];
  let currentSite;
  let edits = {};
  let nodes = [];
  let active;
  let sourceDocument;
  let loading = false;
  let textNodes = new WeakMap();
  let nodeIndexes = new WeakMap();
  let snapshotFingerprint;
  let selectionRequest = 0;
  const snapshots = new Map();
  const sessionDrafts = new Map();
  let dirty = false;
  window.receiveUuHomepage = (id, html) => snapshots.set(id, html);

  async function readSnapshot(id) {
    if (snapshots.has(id)) return Promise.resolve(snapshots.get(id));
    const embedded = el('uu-snapshot-' + id);
    if (embedded) {
      const bytes = Uint8Array.from(atob(embedded.textContent), character => character.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const html = await new Response(stream).text();
      snapshots.set(id, html);
      return Promise.resolve(html);
    }
    return new Promise((resolve, reject) => {
      const script = put('script');
      script.src = 'homepages/' + id + '.js';
      script.onload = () => {
        script.remove();
        const html = snapshots.get(id);
        if (html) resolve(html);
        else reject(new Error('Пустой снимок'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Снимок недоступен'));
      };
      document.head.append(script);
    });
  }

  function editableText(node) {
    if (!textNodes.has(node)) {
      textNodes.set(node, Array.from(node.childNodes).filter(child => child.nodeType === 3 && child.textContent.trim()));
    }
    return textNodes.get(node);
  }

  function description(node) {
    const label = editableText(node).map(child => child.textContent.trim()).join(' ')
      || node.getAttribute('alt') || node.getAttribute('placeholder') || node.id;
    return node.localName + (label ? ' · ' + label.slice(0, 70) : '');
  }

  let page = 0;
  const pageSize = 30;

  function rebuildList() {
    const query = el('homeFind').value.toLowerCase().trim();
    const matching = nodes.filter(node => query
      ? (description(node) + ' ' + node.id).toLowerCase().includes(query)
      : /^(h[1-6]|p|a|button|img|input|select|textarea|title|meta)$/.test(node.localName));
    const view = matching.slice(page * pageSize, (page + 1) * pageSize);
    const list = el('homeList');
    list.replaceChildren(...view.map(node => {
      const item = button(description(node), 'btn home-item', () => selectNode(node));
      item.setAttribute('aria-pressed', String(node === active));
      return item;
    }));
    if (!view.length) list.append(put('p', loading ? 'Открываю страницу…' : 'Элементы не найдены.'));
    const options = view.includes(active) || !active ? view : [...view, active];
    const placeholder = put('option', 'Выбери элемент');
    placeholder.value = '';
    nodeSelector.replaceChildren(placeholder, ...options.map(node => {
      const index = nodeIndexes.get(node);
      const option = put('option', description(node));
      option.value = String(index);
      return option;
    }));
    nodeSelector.value = active ? String(nodeIndexes.get(active)) : '';
    const count = Math.ceil(matching.length / pageSize);
    el('homePrev').disabled = page === 0;
    el('homeNext').disabled = page + 1 >= count;
    el('homePageLabel').textContent = count ? (page + 1) + ' / ' + count : '';
    el('homeResults').textContent = matching.length ? 'Найдено элементов: ' + matching.length : '';

  }

  function flushStatus(text) {
    el('homeStatus').textContent = text;
  }

  function setChange(node, property, value) {
    const index = nodeIndexes.get(node);
    if (!edits[index]) edits[index] = {};
    edits[index][property] = value;
    dirty = true;
    flushStatus('Есть несохранённые изменения');
  }

  function setAttribute(node, name, value) {
    if (['href', 'src', 'poster'].includes(name) && value) {
      try {
        const url = new URL(value, sourceDocument.baseURI);
        const allowed = name === 'href' ? ['https:', 'mailto:', 'tel:'] : ['https:'];
        if (!allowed.includes(url.protocol)) return false;
      } catch {
        return false;
      }
    }
    if (value) node.setAttribute(name, value);
    else node.removeAttribute(name);
    if (name === 'value' && 'value' in node && node.type !== 'file') node.value = value;
    return true;
  }

  function field(container, label, value, update, multiline = false) {
    const wrapper = put('label', label, 'home-field');
    const input = put(multiline ? 'textarea' : 'input');
    input.value = value;
    input.addEventListener('input', () => {
      const valid = update(input.value);
      input.setCustomValidity(valid === false ? 'Допустим HTTPS URL' : '');
      if (valid === false) input.reportValidity();
    });
    wrapper.append(input);
    container.append(wrapper);
  }

  function selectNode(node) {
    active = node;
    rebuildList();
    const inspector = el('homeFields');
    inspector.replaceChildren(put('h3', description(node)));
    const texts = editableText(node);
    texts.forEach((text, index) => field(inspector, 'Текст ' + (index + 1), text.textContent, value => {
      text.textContent = value || '\u00a0';
      setChange(node, 'text:' + index, value);
    }, true));
    const relevant = {
      a: ['href'], img: ['src', 'alt'], video: ['src', 'poster'], source: ['src'],
      input: ['placeholder', 'name', 'value', 'type'], textarea: ['placeholder', 'name'],
      button: ['type', 'value'], select: ['name'], option: ['value'], meta: ['content'],
    };
    const attrs = new Set([...editable.filter(name => node.hasAttribute(name)), ...(relevant[node.localName] || []), 'class', 'style', 'aria-label']);
    for (const name of attrs) {
      field(inspector, name, node.getAttribute(name) || '', value => {
        if (!setAttribute(node, name, value)) return false;
        setChange(node, name, value);
      }, name === 'style');
    }
    const parent = node.parentElement;
    if (nodeIndexes.has(parent)) {
      inspector.prepend(button('Родительский элемент', 'btn', () => selectNode(parent)));
    }
  }

  function initializePage(snapshot) {
    sourceDocument = new DOMParser().parseFromString(snapshot, 'text/html');
    loading = false;
    textNodes = new WeakMap();
    nodes = Array.from(sourceDocument.querySelectorAll('title, meta[name], body, body *')).filter(node => node.localName !== 'style');
    nodeIndexes = new WeakMap(nodes.map((node, index) => [node, index]));
    el('homeExport').disabled = false;
    for (const [index, patch] of Object.entries(edits)) {
      const node = nodes[index];
      if (!node) continue;
      const texts = editableText(node);
      for (const [property, value] of Object.entries(patch)) {
        if (property.startsWith('text:')) {
          const text = texts[Number(property.slice(5))];
          if (text) text.textContent = value || '\u00a0';
        } else if (editable.includes(property)) setAttribute(node, property, value);
      }
    }
    el('homePreview').disabled = false;
    el('homeSave').disabled = false;
    rebuildList();
    flushStatus(dirty ? 'Есть несохранённые изменения' : 'Доступно элементов: ' + nodes.length);
  }

  el('homeSite').replaceChildren(...sites.map(site => {
    const option = put('option', site.name);
    option.value = site.id;
    return option;
  }));

  async function loadSite(id) {
    if (currentSite && !loading) sessionDrafts.set(currentSite, {edits, dirty});
    const request = ++selectionRequest;
    currentSite = id;
    const site = bySite(id);
    el('homeSite').value = id;
    el('homeSource').href = 'https://' + site.domain + '/';
    active = null;
    nodes = [];
    el('homeFields').replaceChildren();
    el('homeFind').value = '';
    page = 0;
    loading = true;
    rebuildList();
    el('homePreview').disabled = true;
    el('homeSave').disabled = true;
    el('homeExport').disabled = true;
    flushStatus('Открываю страницу…');
    let snapshot;
    try { snapshot = await readSnapshot(id); }
    catch {
      if (request !== selectionRequest) return;
      loading = false;
      currentSite = null;
      frame.srcdoc = '';
      flushStatus('Не удалось загрузить страницу. Открой редактор ещё раз.');
      return;
    }
    if (request !== selectionRequest) return;
    snapshotFingerprint = fingerprint(snapshot);
    try {
      const saved = JSON.parse(localStorage.getItem(storagePrefix + id));
      edits = saved?.fingerprint === snapshotFingerprint ? saved.edits : {};
    } catch { edits = {}; }
    const draft = sessionDrafts.get(id);
    if (draft) edits = draft.edits;
    dirty = Boolean(draft?.dirty);
    initializePage(snapshot);
  }

  el('openHome').onclick = () => {
    dialog.showModal();
    if (!currentSite || (selected && selected !== currentSite)) loadSite(selected || 'uu');
  };
  el('homeSite').onchange = () => loadSite(el('homeSite').value);
  el('homeClose').onclick = () => dialog.close();
  el('homeFind').oninput = () => { page = 0; rebuildList(); };
  el('homePrev').onclick = () => { page--; rebuildList(); };
  el('homeNext').onclick = () => { page++; rebuildList(); };
  nodeSelector.onchange = () => {
    if (nodeSelector.value !== '') selectNode(nodes[Number(nodeSelector.value)]);
  };
  el('homeMobile').onclick = () => {
    const mobile = frame.classList.toggle('mobile');
    el('homeMobile').textContent = mobile ? 'Компьютер' : 'Телефон';
    el('homeMobile').setAttribute('aria-pressed', String(mobile));
  };
  function fingerprint(snapshot = '') {
    let hash = 2166136261;
    for (let index = 0; index < snapshot.length; index++) {
      hash = Math.imul(hash ^ snapshot.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
  }

  function serializePage() {
    return '<!doctype html>\n' + sourceDocument.documentElement.outerHTML;
  }

  const preview = el('homePreviewDialog');
  el('homePreview').onclick = () => {
    preview.showModal();
    frame.srcdoc = serializePage();
  };
  el('homePreviewClose').onclick = () => preview.close();
  preview.addEventListener('close', () => frame.removeAttribute('srcdoc'));

  const codeDialog = el('homeCodeDialog');
  const code = el('homeCode');
  let exportedHtml = '';
  el('homeExport').onclick = () => {
    exportedHtml = serializePage();
    code.value = '';
    code.hidden = true;
    el('homeShowCode').hidden = false;
    el('homeCodeStatus').textContent = 'HTML готов к скачиванию.';
    codeDialog.showModal();
  };
  el('homeShowCode').onclick = () => {
    code.value = exportedHtml;
    code.hidden = false;
    el('homeShowCode').hidden = true;
  };
  el('homeCodeClose').onclick = () => codeDialog.close();
  el('homeCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(exportedHtml);
      el('homeCodeStatus').textContent = 'Код скопирован.';
    } catch {
      el('homeShowCode').click();
      code.select();
      el('homeCodeStatus').textContent = 'Код выделен. Скопируй его через меню браузера.';
    }
  };
  el('homeDownload').onclick = () => {
    const url = URL.createObjectURL(new Blob([exportedHtml], {type: 'text/html;charset=utf-8'}));
    const link = put('a');
    link.href = url;
    link.download = bySite(currentSite).domain + '.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  el('homeSave').onclick = () => {
    if (loading || !nodes.length) return;
    try {
      localStorage.setItem(storagePrefix + currentSite, JSON.stringify({fingerprint: snapshotFingerprint, edits}));
      dirty = false;
      sessionDrafts.delete(currentSite);
      flushStatus('Изменения сохранены в этом браузере.');
    } catch {
      flushStatus('Браузер не смог сохранить изменения.');
    }
  };
})();
