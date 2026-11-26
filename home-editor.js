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
    nodes.forEach((node, index) => {
      const label = description(node, index);
      if (label.toLowerCase().includes(query) || node === active) {
        const option = put('option', label);
        option.value = String(index);
        options.push(option);
      }
    });
    nodeSelector.replaceChildren(put('option', 'Выбери элемент'), ...options);
    nodeSelector.firstChild.value = '';
    nodeSelector.value = active ? String(nodes.indexOf(active)) : '';
  }

  function flushStatus(text) {
    el('homeStatus').textContent = text;
  }

  function setChange(node, property, value) {
    const index = nodes.indexOf(node);
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
    if (name === 'value' && 'value' in node) node.value = value;
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
    inspector.replaceChildren(put('h3', description(node, nodes.indexOf(node))));
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
    if (nodes.includes(parent)) {
      inspector.prepend(button('Родительский элемент', 'btn', () => selectNode(parent, true)));
    }
  }

  function initializeFrame() {
    if (!loading) return;
    const {previous, deadline} = pendingFrame;
    const document = frame.contentDocument;
    if (!document?.body || document === previous || document.readyState === 'loading') {
      if (performance.now() < deadline) requestAnimationFrame(initializeFrame);
      else {
        loading = false;
        flushStatus('Предпросмотр недоступен в этом браузере.');
      }
      return;
    }
    frameDocument = document;
    loading = false;
    textNodes = new WeakMap();
    const style = frameDocument.createElement('style');
    style.textContent = '[data-uu-editor-selected]{outline:3px solid #5143df!important;outline-offset:-3px!important}';
    frameDocument.head.append(style);
    nodes = Array.from(frameDocument.querySelectorAll('title, meta[name], body, body *')).filter(node => node.localName !== 'style');
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
      if (nodes.includes(node)) selectNode(node);
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

  function loadSite(id) {
    if (currentSite && el('homeStatus').textContent === 'Есть несохранённые изменения'
      && !window.confirm('Переключить сайт без сохранения изменений?')) {
      el('homeSite').value = currentSite;
      return;
    }
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
    const snapshot = window.UU_HOMEPAGES?.[id];
    try {
      const saved = JSON.parse(localStorage.getItem(storagePrefix + id));
      edits = saved?.fingerprint === fingerprint(snapshot) ? saved.edits : {};
    } catch { edits = {}; }
    if (!snapshot) {
      loading = false;
      frame.srcdoc = '';
      flushStatus('Снимок сайта недоступен.');
      return;
    }
    pendingFrame = {previous: frame.contentDocument, deadline: performance.now() + 15000};
    loading = true;
    flushStatus('Загружаю снимок…');
    frame.srcdoc = snapshot;
    requestAnimationFrame(initializeFrame);
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

  el('homeSave').onclick = () => {
    if (loading || !nodes.length) return;
    try {
      localStorage.setItem(storagePrefix + currentSite, JSON.stringify({fingerprint: fingerprint(window.UU_HOMEPAGES[currentSite]), edits}));
      flushStatus('Изменения сохранены в этом браузере.');
    } catch {
      flushStatus('Браузер не смог сохранить изменения.');
    }
  };
})();
