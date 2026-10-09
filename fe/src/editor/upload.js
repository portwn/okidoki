// Attachments client: files are stored next to the document's .md or in the
// draft folder. resolveAsset turns a relative markdown path into an API URL.

let getters = {
    getDocPath: () => '',
    getDraftId: () => null,
};

export function configureAssets(next) {
    getters = { ...getters, ...next };
}

// Attachment list of the current document/draft (files next to the .md).
let attachmentNames = new Set();

export function setAttachments(names) {
    attachmentNames = new Set(names || []);
}

export function registerAttachment(name) {
    if (name) attachmentNames.add(name);
}

export const HAS_SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_SCHEME = /^(https?:|mailto:|tel:)/i;

// Allowed link schemes. Everything else (javascript:, data:, vbscript:…)
// must not reach the markdown or get opened.
export function isSafeLinkHref(href) {
    if (typeof href !== 'string' || href === '') return true;
    if (!SCHEME_ONLY.test(href)) return true;
    return ALLOWED_SCHEME.test(href);
}

// Attachment — a relative link to a file that actually sits next to the .md.
// Everything else (including ya.ru without a scheme) is a regular link.
export function isAttachmentHref(href) {
    if (typeof href !== 'string' || href === '' || HAS_SCHEME.test(href)) return false;
    const name = href.split('#')[0].split('/').pop();
    return attachmentNames.has(name);
}

export async function uploadFile(file) {
    const form = new FormData();
    form.append('file', file);

    const draftId = getters.getDraftId();
    const docPath = getters.getDocPath();
    if (draftId) {
        form.append('draft', draftId);
    } else if (docPath) {
        form.append('path', docPath);
    }

    const response = await fetch('/api/upload', { method: 'POST', body: form });
    if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
    }
    return response.json();
}

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:)?\/\//i;

function encodePath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

export function resolveAsset(src) {
    if (!src || ABSOLUTE.test(src) || src.startsWith('/') || src.startsWith('data:')) {
        return src;
    }
    const encoded = encodePath(src);
    const draftId = getters.getDraftId();
    if (draftId) {
        return `/api/draftfile/${encodeURIComponent(draftId)}/${encoded}`;
    }
    const docPath = getters.getDocPath();
    if (docPath) {
        return `/api/docfile/${encodePath(docPath)}/${encoded}`;
    }
    return src;
}
