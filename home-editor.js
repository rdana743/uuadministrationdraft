(() => {
  const dialog = el('homeEditor');
  const stage = el('homeStage');
  const visual = el('homeVisual');
  const originalFrame = el('homeOriginalFrame');
  let originalDocument;
  let activeOriginalAssets;
  let originalNodes = new Map();
  let originalTexts = new Map();

  const styleCache = new Map();
  window.receiveUuStyles = (id, assets) => styleCache.set(id, assets);

  async function decodeAsset(embedded) {
    const bytes = Uint8Array.from(atob(embedded.textContent), character => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  async function originalAssets(id) {
    if (styleCache.has(id)) return styleCache.get(id);
    const embedded = el('uu-styles-' + id);
    if (embedded) {
      const assets = JSON.parse(await decodeAsset(embedded));
      styleCache.set(id, assets);
      return assets;
    }
    return new Promise(resolve => {
      const script = put('script');
      script.src = 'styles/' + id + '.js?v=original3';
      script.onload = () => {
        script.remove();
        resolve(id === 'bhsad' ? window.uuBritanka : styleCache.get(id));
      };
      script.onerror = () => { script.remove(); resolve(); };
      document.head.append(script);
    });
  }

  function setOriginalMode() {
    for (const [index, texts] of originalTexts) {
      for (const [offset, editor] of texts.entries()) {
        if (!editor) continue;
        editor.contentEditable = previewMode ? 'false' : 'plaintext-only';
        editor.tabIndex = previewMode ? -1 : 0;
        editor.setAttribute('aria-label', 'Текст на странице');
        editor.onfocus = () => selectNode(nodes[index], false);
        editor.oninput = () => {
          const value = editor.textContent;
          const source = editableText(nodes[index])[offset];
          source.textContent = value || '\u00a0';
          setChange(nodes[index], 'text:' + offset, value);
          const input = el('homeFields').querySelectorAll('[data-uu-text]')[offset];
          if (active === nodes[index] && input) input.value = value;
        };
      }
    }
    originalDocument?.documentElement.classList.toggle('uu-editing', !previewMode);
  }

  function originalStyle(css) {
    const sheet = put('style');
    sheet.textContent = css.replace(/<\/style/gi, match => match.replace('<', '\\3c '));
    return sheet;
  }

  function applyOriginalStyles(clone, id, assets = {}) {
    const head = clone.querySelector('head');
    const links = head.querySelectorAll('link[rel=stylesheet]');
    for (const link of links) {
      const cached = assets.styles?.[link.getAttribute('href')];
      if (cached) link.replaceWith(originalStyle(cached));
      else if (assets.css) link.remove();
    }
    if (assets.css) head.append(originalStyle(assets.css));
    head.append(originalStyle(`
      html.uu-editing [contenteditable=plaintext-only]{cursor:text}
      html.uu-editing [contenteditable=plaintext-only]:focus{outline:2px solid #7165ff;outline-offset:2px}
      .t-animate,.t-animate_started,.t-animate_wait,.t396__elem .tn-atom[data-animate-sbs-event]{opacity:1!important;visibility:visible!important}
      #allrecords{opacity:1!important;visibility:visible!important}
    `));
    const responsiveRules = new Set();
    for (const record of clone.querySelectorAll('[class*="t-screen"]')) {
      for (const name of record.classList) {
        const match = /^t-screen(min|max)-(\d+)px$/.exec(name);
        if (!match) continue;
        const [, bound, width] = match;
        const limit = bound === 'min' ? Number(width) - 0.02 : Number(width);
        responsiveRules.add('@media (' + (bound === 'min' ? 'max' : 'min') + '-width:' + limit + 'px){.' + name + '{display:none!important}}');
      }
    }
    if (responsiveRules.size) head.append(originalStyle([...responsiveRules].join('')));
    if (id === 'scream' && clone.querySelector('#rec2048276891')) {
      head.append(originalStyle('#rec2048276991{display:none!important}'));
    }
    if (id === 'bhsad') {
      clone.querySelector('header.header')?.classList.add('headroom');
      head.append(originalStyle('.announce-big__bg,.announce-big__container{opacity:1!important}.announce-big__preloader{display:none!important}'));
      for (const [kind, url] of Object.entries(assets.images || {})) {
        const image = clone.querySelector('.announce-slider__slide.is-active .announce-slider__image-' + kind + ' img');
        if (image && !image.getAttribute('src')) image.setAttribute('src', url);
      }
    }
    for (const image of clone.querySelectorAll('img[src]')) {
      if (!image.closest('.announce-slider__slide.is-active')) image.loading = 'lazy';
    }
  }

  async function renderOriginal(id, request) {
    const assets = await originalAssets(id) || {};
    if (request !== selectionRequest) return;
    activeOriginalAssets = assets;
    const clone = sourceDocument.documentElement.cloneNode(true);
    applyOriginalStyles(clone, id, assets);
    clone.setAttribute('data-uu-preview', String(request));
    const body = clone.querySelector('body');
    const marked = Array.from(clone.querySelectorAll('title, meta[name], body, body *')).filter(node => node.localName !== 'style');
    for (const [index, node] of marked.entries()) {
      node.setAttribute('data-uu-index', String(index));
      if (!body.contains(node) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
      const texts = editableText(nodes[index]);
      if (!texts.length || !/^(h[1-6]|p|a|button|div|span|li|strong|b|em|label)$/.test(node.localName)) continue;
      const children = Array.from(node.childNodes);
      for (const [offset, text] of texts.entries()) {
        const copy = children[Array.from(nodes[index].childNodes).indexOf(text)];
        if (copy?.nodeType !== 3) continue;
        const wrapper = put('span', copy.textContent);
        wrapper.setAttribute('data-uu-text-offset', String(offset));
        copy.replaceWith(wrapper);
      }
    }
    const previous = originalFrame.contentDocument;
    originalFrame.srcdoc = '<!doctype html>' + clone.outerHTML;
    originalFrame.classList.add('uu-original-loading');
    originalFrame.hidden = false;
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      function ready() {
        if (request !== selectionRequest) return resolve();
        const doc = originalFrame.contentDocument;
        if (doc && doc !== previous && doc.documentElement?.getAttribute('data-uu-preview') === String(request) && doc.readyState !== 'loading') return resolve();
        if (performance.now() > deadline) return reject(new Error('Предпросмотр не открылся'));
        requestAnimationFrame(ready);
      }
      requestAnimationFrame(ready);
    });
    if (request !== selectionRequest) return;
    originalDocument = originalFrame.contentDocument;
    originalFrame.classList.remove('uu-original-loading');
    visual.hidden = true;
    el('homeMore').hidden = true;
    for (const node of originalDocument.querySelectorAll('[data-uu-index]')) {
      const index = Number(node.dataset.uuIndex);
      originalNodes.set(index, node);
      const texts = [];
      for (const child of node.children) {
        if (child.hasAttribute('data-uu-text-offset')) texts[Number(child.dataset.uuTextOffset)] = child;
      }
      if (texts.length) originalTexts.set(index, texts);
    }
    originalDocument.addEventListener('submit', event => event.preventDefault());
    originalDocument.addEventListener('auxclick', event => event.preventDefault());
    originalDocument.addEventListener('click', event => {
      event.preventDefault();
      if (previewMode) return;
      const node = event.target.closest('[data-uu-index]');
      if (node) selectNode(nodes[Number(node.dataset.uuIndex)], false);
    });
    setOriginalMode();
  }

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
  let previewMode = false;
  let blocks = [];
  let shownBlocks = 0;
  let textControls = new Map();
  let imageControls = new Map();
  const previousFingerprints = new Map();
  window.receiveUuHomepage = (id, html, previousFingerprint) => {
    snapshots.set(id, html);
    if (previousFingerprint !== undefined) previousFingerprints.set(id, previousFingerprint);
  };

  async function readSnapshot(id) {
    if (snapshots.has(id)) return Promise.resolve(snapshots.get(id));
    const embedded = el('uu-snapshot-' + id);
    if (embedded) {
      const html = await decodeAsset(embedded);
      window.receiveUuHomepage(id, html, embedded.dataset.previous ? Number(embedded.dataset.previous) : undefined);
      return html;
    }
    return new Promise((resolve, reject) => {
      const script = put('script');
      script.src = 'homepages/' + id + '.js?v=original3';
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
    return input;
  }

  function buildBlocks() {
    const groups = [];
    let current;
    let previousContainer;
    const main = sourceDocument.querySelector('main, [role=main]');
    const heading = sourceDocument.querySelector('h1');
    const start = !main && heading ? nodeIndexes.get(heading) : 0;
    for (const node of nodes.slice(start || 0)) {
      if (!(main || sourceDocument.body).contains(node) || node.closest('header,nav,footer,form,[hidden],.t-popup,.t-form')) continue;
      const tag = node.localName;
      const texts = editableText(node);
      const image = tag === 'img' && node.getAttribute('src');
      if (!image && (!texts.length || !/^(h[1-6]|p|a|button|div|span|li|strong|b|em|td|label)$/.test(tag))) continue;
      if (tag === 'div' || tag === 'span') {
        if (texts.every(text => text.textContent.trim().length < 3)) continue;
      }
      const container = node.closest('.t-rec, main > section, main > article, body > section');
      if (!current || (container && container !== previousContainer) || current.length >= 18 || (!container && /^h[1-3]$/.test(tag))) {
        current = [];
        groups.push(current);
      }
      previousContainer = container;
      current.push(node);
    }
    return groups.length ? groups : [nodes.filter(node => node.localName === 'title')];
  }

  function updateCanvasText(text, value, origin) {
    const index = nodeIndexes.get(active);
    const original = originalTexts.get(index)?.[editableText(active).indexOf(text)];
    if (original) original.textContent = value || '\u00a0';
    const control = textControls.get(text);
    if (control && control !== origin) control.textContent = value;
  }

  function renderBlock(group, index) {
    const block = put('section', '', 'uu-block' + (index === 0 ? ' uu-cover' : ''));
    const content = put('div', '', 'uu-block-content');
    for (const node of group) {
      const tag = node.localName;
      if (tag === 'img') {
        const label = node.getAttribute('alt') || 'Изображение';
        const card = previewMode ? put('div', '', 'uu-image') : button('', 'uu-image', () => selectNode(node, false));
        const image = put('img');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = label;
        try {
          const url = new URL(node.getAttribute('src'), sourceDocument.baseURI);
          if (url.protocol === 'https:') image.src = url.href;
        } catch {}
        const fallback = put('span', label);
        fallback.hidden = true;
        image.onerror = () => { image.hidden = true; fallback.hidden = false; };
        image.onload = () => { image.hidden = false; fallback.hidden = true; };
        imageControls.set(node, {image, fallback});
        card.append(fallback);
        card.append(image);
        content.append(card);
        continue;
      }
      const heading = /^h[1-6]$/.test(tag) || (index === 0 && !content.childElementCount);
      const element = put(heading ? (index === 0 ? 'h2' : 'h3') : 'div', '', (tag === 'a' || tag === 'button') ? 'uu-cta' : 'uu-copy');
      editableText(node).forEach((text, textIndex) => {
        const piece = put('span', text.textContent);
        if (!previewMode) {
          textControls.set(text, piece);
          piece.contentEditable = 'plaintext-only';
          piece.spellcheck = false;
          piece.setAttribute('role', 'textbox');
          piece.setAttribute('aria-label', 'Текст на холсте');
          piece.addEventListener('focus', () => selectNode(node, false));
          piece.addEventListener('input', () => {
            const value = piece.innerText;
            text.textContent = value || '\u00a0';
            setChange(node, 'text:' + textIndex, value);
            const input = el('homeFields').querySelectorAll('[data-uu-text]')[textIndex];
            if (active === node && input) input.value = value;
          });
        }
        element.append(piece);
      });
      content.append(element);
    }
    block.append(content);
    return block;
  }

  function appendBlocks() {
    const end = Math.min(blocks.length, shownBlocks + 6);
    for (; shownBlocks < end; shownBlocks++) visual.append(renderBlock(blocks[shownBlocks], shownBlocks));
    el('homeMore').hidden = shownBlocks >= blocks.length;
  }

  function renderCanvas() {
    textControls = new Map();
    imageControls = new Map();
    shownBlocks = 0;
    visual.replaceChildren();
    appendBlocks();
  }

  function selectNode(node, updateList = true) {
    active = node;
    if (updateList) rebuildList();
    const inspector = el('homeFields');
    inspector.replaceChildren(put('h3', description(node)));
    const texts = editableText(node);
    texts.forEach((text, index) => field(inspector, 'Текст ' + (index + 1), text.textContent, value => {
      text.textContent = value || '\u00a0';
      setChange(node, 'text:' + index, value);
      updateCanvasText(text, value);
    }, true).dataset.uuText = String(index));
    const relevant = {
      a: ['href'], img: ['src', 'alt'], video: ['src', 'poster'], source: ['src'],
      input: ['placeholder', 'name', 'value', 'type'], textarea: ['placeholder', 'name'],
      button: ['type', 'value'], select: ['name'], option: ['value'], meta: ['content'],
    };
    const attrs = new Set([...editable.filter(name => node.hasAttribute(name)), ...(relevant[node.localName] || []), 'class', 'style', 'aria-label']);
    for (const name of attrs) {
      const input = field(inspector, name, node.getAttribute(name) || '', value => {
        if (!setAttribute(node, name, value)) return false;
        setChange(node, name, value);
        const original = originalNodes.get(nodeIndexes.get(node));
        if (original) setAttribute(original, name, value);

      }, name === 'style');
      if (name === 'src' || name === 'alt') input.addEventListener('change', () => {
        const control = imageControls.get(node);
        if (!control) return;
        const label = node.getAttribute('alt') || 'Изображение';
        control.image.alt = label;
        control.fallback.textContent = label;
        const source = node.getAttribute('src');
        if (source) control.image.src = new URL(source, sourceDocument.baseURI).href;
        else {
          control.image.removeAttribute('src');
          control.image.hidden = true;
          control.fallback.hidden = false;
        }
      });
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
    blocks = buildBlocks();
    renderCanvas();
    {
      const request = selectionRequest;
      renderOriginal(currentSite, request).catch(() => {
        if (request !== selectionRequest) return;
        originalFrame.hidden = true;
        visual.hidden = false;
        renderCanvas();
        flushStatus('Оригинальная вёрстка недоступна. Открыт блочный холст.');
      });
    }
    el('homeMobile').disabled = false;
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
    originalDocument = undefined;
    activeOriginalAssets = undefined;
    originalNodes = new Map();
    originalTexts = new Map();
    originalFrame.hidden = true;
    originalFrame.classList.remove('uu-original-loading');
    originalFrame.removeAttribute('srcdoc');
    visual.hidden = false;
    currentSite = id;
    const site = bySite(id);
    el('homeSite').value = id;
    el('homeSource').href = 'https://' + site.domain + '/';
    active = null;
    nodes = [];
    blocks = [];
    visual.replaceChildren(put('p', 'Открываю страницу…', 'uu-empty'));
    el('homeMore').hidden = true;
    el('homeFields').replaceChildren();
    el('homeFind').value = '';
    page = 0;
    loading = true;
    rebuildList();
    el('homePreview').disabled = true;
    el('homeMobile').disabled = true;
    el('homeSave').disabled = true;
    el('homeExport').disabled = true;
    flushStatus('Открываю страницу…');
    let snapshot;
    try { snapshot = await readSnapshot(id); }
    catch {
      if (request !== selectionRequest) return;
      loading = false;
      currentSite = null;
      visual.replaceChildren(put('p', 'Не удалось открыть страницу.', 'uu-empty'));
      flushStatus('Не удалось загрузить страницу. Открой редактор ещё раз.');
      return;
    }
    if (request !== selectionRequest) return;
    snapshotFingerprint = fingerprint(snapshot);
    try {
      const saved = JSON.parse(localStorage.getItem(storagePrefix + id));
      edits = saved && (saved.fingerprint === snapshotFingerprint || saved.fingerprint === previousFingerprints.get(id)) ? saved.edits : {};
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
    const mobile = stage.classList.toggle('mobile');
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
    const page = sourceDocument.documentElement.cloneNode(true);
    if (activeOriginalAssets) applyOriginalStyles(page, currentSite, activeOriginalAssets);
    return '<!doctype html>\n' + page.outerHTML;
  }

  el('homeMore').onclick = appendBlocks;
  el('homePreview').onclick = () => {
    previewMode = !previewMode;
    stage.classList.toggle('uu-readonly', previewMode);
    dialog.classList.toggle('uu-preview-wide', previewMode);
    el('homePreview').textContent = previewMode ? 'К редактированию' : 'Предпросмотр';
    el('homePreview').setAttribute('aria-pressed', String(previewMode));
    if (originalDocument) return setOriginalMode();
    const count = shownBlocks;
    renderCanvas();
    while (shownBlocks < count) appendBlocks();
  };

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
