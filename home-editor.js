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
  let marker;
  let frameDocument;
  let loading = false;
  let pendingFrame;
  let textNodes = new WeakMap();
  let nodeIndexes = new WeakMap();
  let snapshotFingerprint;
  let selectionRequest = 0;
  let editorStyle;
  const snapshots = new Map();
  window.receiveUuHomepage = (id, html) => snapshots.set(id, html);

  function readSnapshot(id) {
    if (snapshots.has(id)) return Promise.resolve(snapshots.get(id));
    const embedded = el('uu-snapshot-' + id);
    if (embedded) {
      const html = JSON.parse(embedded.textContent);
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

  function description(node, index) {
    const label = editableText(node).map(child => child.textContent.trim()).join(' ')
      || node.getAttribute('alt') || node.getAttribute('placeholder') || node.id;
    return index + ' · ' + node.localName + (label ? ' · ' + label.slice(0, 70) : '');
  }

  function rebuildList() {
    const query = el('homeFind').value.toLowerCase().trim();
    const options = [];
    const limit = 80;
    const selectedIndex = nodeIndexes.get(active);
    let matches = 0;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const label = description(node, index);
      const match = !query || (label + ' ' + node.id).toLowerCase().includes(query);
      if (match) matches++;
      if ((match && matches <= limit) || index === selectedIndex) {
        const option = put('option', label);
        option.value = String(index);
        options.push(option);
      }
    }
    const placeholder = put('option', 'Выбери элемент');
    placeholder.value = '';
    nodeSelector.replaceChildren(placeholder, ...options);
    nodeSelector.value = selectedIndex === undefined ? '' : String(selectedIndex);
    el('homeResults').textContent = matches > limit
      ? 'Первые ' + limit + ' из ' + matches + '. Уточни поиск.'
      : '';
  }

  function flushStatus(text) {
    el('homeStatus').textContent = text;
  }

  function setChange(node, property, value) {
    const index = nodeIndexes.get(node);
    if (!edits[index]) edits[index] = {};
    edits[index][property] = value;
    flushStatus('Есть несохранённые изменения');
  }

  function setAttribute(node, name, value) {
    if (['href', 'src', 'poster'].includes(name) && value) {
      try {
        const url = new URL(value, frameDocument.baseURI);
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

  function selectNode(node, scroll = false) {
    active = node;
    if (marker) marker.removeAttribute('data-uu-editor-selected');
    marker = frameDocument.body.contains(node) ? node : null;
    if (marker) marker.setAttribute('data-uu-editor-selected', '');
    if (scroll && marker) marker.scrollIntoView({block: 'nearest'});
    rebuildList();
    const inspector = el('homeFields');
    inspector.replaceChildren(put('h3', description(node, nodeIndexes.get(node))));
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
      inspector.prepend(button('Родительский элемент', 'btn', () => selectNode(parent, true)));
    }
  }

  function initializeFrame(request) {
    if (request !== selectionRequest || !loading) return;
    const {previous, deadline} = pendingFrame;
    const document = frame.contentDocument;
    if (!document?.body || document === previous || document.readyState === 'loading') {
      if (performance.now() < deadline) requestAnimationFrame(() => initializeFrame(request));
      else {
        loading = false;
        flushStatus('Предпросмотр недоступен в этом браузере.');
      }
      return;
    }
    frameDocument = document;
    loading = false;
    textNodes = new WeakMap();
    editorStyle = frameDocument.createElement('style');
    editorStyle.textContent = '[data-uu-editor-selected]{outline:3px solid #5143df!important;outline-offset:-3px!important}';
    frameDocument.head.append(editorStyle);
    nodes = Array.from(frameDocument.querySelectorAll('title, meta[name], body, body *')).filter(node => node.localName !== 'style');
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
    frameDocument.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const node = event.target.closest?.('body, body *');
      if (nodeIndexes.has(node)) selectNode(node);
    }, true);
    frameDocument.addEventListener('submit', event => event.preventDefault(), true);
    rebuildList();
    flushStatus('Снимок загружен · ' + nodes.length + ' элементов');
  }

  el('homeSite').replaceChildren(...sites.map(site => {
    const option = put('option', site.name);
    option.value = site.id;
    return option;
  }));

  async function loadSite(id) {
    if (currentSite && el('homeStatus').textContent === 'Есть несохранённые изменения'
      && !window.confirm('Переключить сайт без сохранения изменений?')) {
      el('homeSite').value = currentSite;
      return;
    }
    const request = ++selectionRequest;
    currentSite = id;
    const site = bySite(id);
    el('homeSite').value = id;
    el('homeSource').href = 'https://' + site.domain + '/';
    active = null;
    marker = null;
    nodes = [];
    el('homeFields').replaceChildren();
    el('homeFind').value = '';
    rebuildList();
    loading = true;
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
    pendingFrame = {previous: frame.contentDocument, deadline: performance.now() + 15000};
    frame.srcdoc = snapshot;
    requestAnimationFrame(() => initializeFrame(request));
  }

  el('openHome').onclick = () => {
    dialog.showModal();
    if (!currentSite || (selected && selected !== currentSite)) loadSite(selected || 'uu');
  };
  el('homeSite').onchange = () => loadSite(el('homeSite').value);
  el('homeClose').onclick = () => dialog.close();
  el('homeFind').oninput = rebuildList;
  nodeSelector.onchange = () => {
    if (nodeSelector.value !== '') selectNode(nodes[Number(nodeSelector.value)], true);
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

  const codeDialog = el('homeCodeDialog');
  const code = el('homeCode');
  el('homeExport').onclick = () => {
    if (loading || !frameDocument) return;
    const clone = frameDocument.documentElement.cloneNode(true);
    clone.querySelector('[data-uu-editor-selected]')?.removeAttribute('data-uu-editor-selected');
    const styleIndex = Array.from(frameDocument.head.children).indexOf(editorStyle);
    clone.querySelector('head').children[styleIndex]?.remove();
    code.value = '<!doctype html>\n' + clone.outerHTML;
    el('homeCodeStatus').textContent = '';
    codeDialog.showModal();
  };
  el('homeCodeClose').onclick = () => codeDialog.close();
  el('homeCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(code.value);
      el('homeCodeStatus').textContent = 'Код скопирован.';
    } catch {
      code.select();
      el('homeCodeStatus').textContent = 'Код выделен. Скопируй его через меню браузера.';
    }
  };
  el('homeDownload').onclick = () => {
    const url = URL.createObjectURL(new Blob([code.value], {type: 'text/html;charset=utf-8'}));
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
      flushStatus('Изменения сохранены в этом браузере.');
    } catch {
      flushStatus('Браузер не смог сохранить изменения.');
    }
  };
})();
