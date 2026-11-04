const viewer = document.getElementById('viewer'),
  status = document.getElementById('status');
const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const source = '/documents/' + pageData.id + '/source';
const selected = new URLSearchParams(location.search).get('anchor');
const selectedKey = new URLSearchParams(location.search).get('evidence');
let frame = null,
  pdf = null,
  ensurePage = null;
function tell(text) {
  status.textContent = text;
}
function extractedPageText(anchors, page) {
  let text = '';
  for (const anchor of anchors.filter((a) => a.page === page)) {
    const offset = Number(anchor.id.split('-').at(-1));
    text += anchor.text.slice(
      Number.isFinite(offset) ? Math.max(0, text.length - offset) : 0,
    );
  }
  return text;
}
async function focusEvidence(e) {
  tell(e.explanation || e.quote);
  if (pageData.kind === 'pdf') {
    const anchor = pageData.anchors.find((a) => a.id === e.anchor);
    const n = anchor?.page;
    if (!n) {
      tell(
        (pageData.lang === 'de'
          ? 'Exakte Seitenposition nicht verfügbar. '
          : 'Exact page anchor unavailable. ') + (e.explanation || ''),
      );
      return;
    }
    await ensurePage(n);
    const section = document.getElementById('page-' + n);
    if (section)
      viewer.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
    const page = await pdf.getPage(n),
      viewport = page.getViewport({ scale: 1.2 }),
      content = await page.getTextContent();
    const strings = content.items.map((x) => normalize(x.str));
    const full = strings.join(' ');
    const start = full.indexOf(normalize(e.quote));
    section?.querySelectorAll('.highlight').forEach((x) => x.remove());
    if (start < 0) {
      tell(
        (pageData.lang === 'de'
          ? 'Passage auf dieser Seite; exakte Hervorhebung nicht verfügbar. '
          : 'Passage is on this page; exact highlight unavailable. ') +
          (e.explanation || ''),
      );
      return;
    }
    let offset = 0;
    for (let i = 0; i < content.items.length; i++) {
      const item = content.items[i],
        end = offset + strings[i].length;
      if (end > start && offset < start + normalize(e.quote).length) {
        const m = (await import('/viewer-assets/pdf.mjs')).Util.transform(
          viewport.transform,
          item.transform,
        );
        const h = Math.hypot(m[2], m[3]),
          b = document.createElement('button');
        b.className = 'highlight';
        b.type = 'button';
        b.setAttribute('aria-label', e.explanation || e.quote);
        b.title = e.explanation || e.quote;
        Object.assign(b.style, {
          position: 'absolute',
          left: m[4] + 'px',
          top: m[5] - h + 'px',
          width: Math.max(item.width * viewport.scale, 5) + 'px',
          height: Math.max(h, 5) + 'px',
          minHeight: '0',
          padding: '0',
          border: '0',
          borderRadius: '0',
          background: 'rgba(191,216,237,.5)',
        });
        b.addEventListener('click', () => {
          tell(e.explanation || e.quote);
          status.focus();
        });
        section.querySelector('.page-image').append(b);
      }
      offset = end + 1;
    }
  } else if (frame?.contentDocument) {
    const doc = frame.contentDocument;
    doc.querySelectorAll('mark').forEach((m) => m.replaceWith(...m.childNodes));
    doc.body.normalize();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT),
      nodes = [];
    let text = '',
      node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('style,script')) continue;
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    const map = [],
      chars = [];
    for (let i = 0; i < text.length; i++) {
      if (/\s/.test(text[i])) {
        if (chars.at(-1) === ' ') continue;
        chars.push(' ');
      } else chars.push(text[i]);
      map.push(i);
    }
    const needle = normalize(e.quote),
      index = chars.join('').indexOf(needle);
    if (index < 0) {
      tell(
        (pageData.lang === 'de'
          ? 'Exakte Position nicht verfügbar. '
          : 'Exact anchor unavailable. ') + (e.explanation || ''),
      );
      return;
    }
    const begin = map[index],
      end = map[index + needle.length - 1] + 1;
    for (const x of nodes.reverse()) {
      const a = Math.max(begin - x.start, 0),
        b = Math.min(end - x.start, x.node.textContent.length);
      if (b <= a) continue;
      const range = doc.createRange();
      range.setStart(x.node, a);
      range.setEnd(x.node, b);
      const mark = doc.createElement('mark');
      range.surroundContents(mark);
      mark.tabIndex = 0;
      mark.addEventListener('click', () => tell(e.explanation || e.quote));
      mark.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') tell(e.explanation || e.quote);
      });
    }
    doc.querySelector('mark')?.scrollIntoView({ block: 'center' });
  }
}
try {
  status.tabIndex = -1;
  if (pageData.kind === 'pdf') {
    const lib = await import('/viewer-assets/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = '/viewer-assets/pdf.worker.mjs';
    pdf = await lib.getDocument({
      url: source,
      isEvalSupported: false,
      enableXfa: false,
    }).promise;
    const rendered = new Set(),
      pending = new Map();
    ensurePage = async (n) => {
      if (rendered.has(n)) return;
      if (pending.has(n)) return pending.get(n);
      const task = (async () => {
        const page = await pdf.getPage(n),
          viewport = page.getViewport({ scale: 1.2 }),
          section = document
            .getElementById('page-' + n)
            .querySelector('.page-image'),
          canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.maxWidth = 'none';
        canvas.setAttribute(
          'aria-label',
          (pageData.lang === 'de' ? 'Seite ' : 'Page ') + n,
        );
        section.append(canvas);
        section.style.height = viewport.height + 'px';
        section.style.width = viewport.width + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport })
          .promise;
        rendered.add(n);
        for (const old of [...rendered])
          if (Math.abs(old - n) > 3) {
            document
              .getElementById('page-' + old)
              ?.querySelector('.page-image')
              .replaceChildren();
            rendered.delete(old);
          }
      })();
      pending.set(n, task);
      try {
        await task;
      } finally {
        pending.delete(n);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting)
            ensurePage(Number(e.target.dataset.page)).catch((error) =>
              tell(error.message),
            );
      },
      { rootMargin: '300px' },
    );
    for (let n = 1; n <= pdf.numPages; n++) {
      const section = document.createElement('div');
      section.id = 'page-' + n;
      section.dataset.page = String(n);
      const image = document.createElement('div');
      image.className = 'page-image';
      Object.assign(image.style, { height: '1000px', width: '730px' });
      const text = document.createElement('details');
      text.className = 'page-text';
      const label = document.createElement('summary');
      label.textContent =
        (pageData.lang === 'de'
          ? 'Extrahierter Text — Seite '
          : 'Extracted text — page ') + n;
      const content = document.createElement('pre');
      content.textContent =
        extractedPageText(pageData.anchors, n) ||
        (pageData.lang === 'de'
          ? 'Kein lesbarer Text für diese Seite verfügbar.'
          : 'No readable text available for this page.');
      text.append(label, content);
      section.append(image, text);
      viewer.append(section);
      observer.observe(section);
    }
    viewer.style.overflow = 'auto';
    await ensurePage(1);
  } else {
    frame = document.createElement('iframe');
    frame.title =
      pageData.lang === 'de' ? 'Originaldokument' : 'Source document';
    frame.sandbox = 'allow-same-origin';
    frame.src = source;
    viewer.append(frame);
    await new Promise((resolve) =>
      frame.addEventListener('load', resolve, { once: true }),
    );
  }
  document
    .querySelectorAll('[data-evidence]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        focusEvidence(pageData.entries[Number(button.dataset.evidence)]).catch(
          (e) => tell(e.message),
        ),
      ),
    );
  const entry = pageData.entries.find(
    (e) =>
      e.anchor === selected && (!selectedKey || e.evidenceKey === selectedKey),
  );
  if (entry) await focusEvidence(entry);
} catch (e) {
  tell(
    (pageData.lang === 'de'
      ? 'Dokumentansicht nicht verfügbar: '
      : 'Document view unavailable: ') + e.message,
  );
}
