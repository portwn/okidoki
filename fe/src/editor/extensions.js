import { useEffect, useRef } from 'react';
import { Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { isAttachmentHref, isSafeLinkHref } from './upload';
import { createLowlight, common } from 'lowlight';

const lowlight = createLowlight(common);

// Mod-K opens the link popover in the toolbar.
const LinkShortcut = Extension.create({
    name: 'linkShortcut',
    addKeyboardShortcuts() {
        return {
            'Mod-k': () => {
                this.editor.emit('rte:openLink');
                return true;
            },
        };
    },
});

// Confluence-style heading hotkeys: Mod-1/2/3.
// Mod-Alt-1/2/3 are duplicated because browsers reserve Ctrl/Cmd+1..9 for tabs.
const HeadingShortcut = Extension.create({
    name: 'headingShortcut',
    addKeyboardShortcuts() {
        const setHeading = (level) => () =>
            this.editor.chain().focus().toggleHeading({ level }).run();
        return {
            'Mod-1': setHeading(1),
            'Mod-2': setHeading(2),
            'Mod-3': setHeading(3),
            'Mod-Alt-1': setHeading(1),
            'Mod-Alt-2': setHeading(2),
            'Mod-Alt-3': setHeading(3),
        };
    },
});

// Strikethrough: Mod-Shift-X (Strike's built-in Mod-Shift-S also stays).
const StrikeShortcut = Extension.create({
    name: 'strikeShortcut',
    addKeyboardShortcuts() {
        return {
            'Mod-Shift-x': () => this.editor.chain().focus().toggleStrike().run(),
        };
    },
});

// Quote and divider. Quote — Mod-Shift-. as in Confluence
// (StarterKit's built-in Mod-Shift-B also stays);
// horizontal rule — Mod-Alt-H (no single standard exists).
const FormattingShortcut = Extension.create({
    name: 'formattingShortcut',
    addKeyboardShortcuts() {
        const toggleQuote = () => this.editor.chain().focus().toggleBlockquote().run();
        return {
            'Mod-Shift-.': toggleQuote,
            'Mod-Shift->': toggleQuote,
            'Mod-Alt-h': () => this.editor.chain().focus().setHorizontalRule().run(),
        };
    },
});

// Lists: Mod-7/8/9 (like headings) + Mod-Shift-7/8/9 (like Google Docs).
const ListShortcut = Extension.create({
    name: 'listShortcut',
    addKeyboardShortcuts() {
        return {
            'Mod-7': () => this.editor.chain().focus().toggleOrderedList().run(),
            'Mod-8': () => this.editor.chain().focus().toggleBulletList().run(),
            'Mod-9': () => this.editor.chain().focus().toggleTaskList().run(),
            'Mod-Shift-7': () => this.editor.chain().focus().toggleOrderedList().run(),
            'Mod-Shift-8': () => this.editor.chain().focus().toggleBulletList().run(),
            'Mod-Shift-9': () => this.editor.chain().focus().toggleTaskList().run(),
        };
    },
});

const MIN_IMAGE_SIZE = 32;

// Image size is stored in markdown as a URL fragment: ![alt](photo.png#w=300&h=200).
// This way the size survives saving while remaining valid Markdown.
function splitSizeFragment(href) {
    const hashIndex = href.indexOf('#');
    if (hashIndex === -1) return { src: href, width: null, height: null };
    const fragment = href.slice(hashIndex + 1);
    if (!/^([wh]=\d+)(&[wh]=\d+)*$/.test(fragment)) {
        return { src: href, width: null, height: null };
    }
    const width = /(?:^|&)w=(\d+)/.exec(fragment);
    const height = /(?:^|&)h=(\d+)/.exec(fragment);
    return {
        src: href.slice(0, hashIndex),
        width: width ? parseInt(width[1], 10) : null,
        height: height ? parseInt(height[1], 10) : null,
    };
}

function sizeFragment(width, height) {
    const parts = [];
    if (width) parts.push(`w=${Math.round(width)}`);
    if (height) parts.push(`h=${Math.round(height)}`);
    return parts.join('&');
}

// The image keeps a relative path in the src attribute (it also goes to Markdown)
// and displays it through resolveAsset: an object URL in the mock, /api/docfile later.
// Resize: corner keeps the aspect ratio, bottom/right change one side only.
function ImageView({ node, extension, selected, editor, updateAttributes }) {
    const resolve = extension.options.resolveAsset;
    const src = resolve ? resolve(node.attrs.src) : node.attrs.src;
    const imgRef = useRef(null);
    const cleanupRef = useRef(null);
    const editable = editor?.isEditable;
    const width = node.attrs.width || null;
    const height = node.attrs.height || null;

    // If the node unmounts mid-resize — remove the listeners.
    useEffect(() => () => {
        if (cleanupRef.current) cleanupRef.current();
    }, []);

    const beginResize = (mode) => (event) => {
        if (!editable) return;
        event.preventDefault();
        event.stopPropagation();
        const el = imgRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const container = el.closest('.rte-content');
        const maxWidth = container ? container.clientWidth - 32 : Infinity;
        const start = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height };

        const onMove = (e) => {
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            let w = start.w;
            let h = start.h;
            if (mode === 'corner') {
                const scale = Math.max((start.w + dx) / start.w, (start.h + dy) / start.h);
                w = Math.min(start.w * scale, maxWidth);
                h = start.h * (w / start.w);
            } else if (mode === 'bottom') {
                h = start.h + dy;
            } else {
                w = Math.min(start.w + dx, maxWidth);
            }
            w = Math.max(MIN_IMAGE_SIZE, w);
            h = Math.max(MIN_IMAGE_SIZE, h);
            el.style.width = `${Math.round(w)}px`;
            el.style.height = `${Math.round(h)}px`;
        };
        const onUp = () => {
            if (cleanupRef.current) cleanupRef.current();
            cleanupRef.current = null;
            const finalW = Math.round(parseFloat(el.style.width));
            const finalH = Math.round(parseFloat(el.style.height));
            if (Number.isFinite(finalW) && Number.isFinite(finalH)) {
                updateAttributes({ width: finalW, height: finalH });
            }
        };
        cleanupRef.current = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    };

    return (
        <NodeViewWrapper as="div" className={`rte-image${selected ? ' is-selected' : ''}`}>
            <img
                ref={imgRef}
                src={src}
                alt={node.attrs.alt || ''}
                title={node.attrs.title || ''}
                draggable="false"
                style={{
                    width: width ? `${width}px` : undefined,
                    height: height ? `${height}px` : undefined,
                }}
            />
            {editable && (
                <>
                    <span className="rte-image-handle is-corner" onPointerDown={beginResize('corner')} />
                    <span className="rte-image-handle is-bottom" onPointerDown={beginResize('bottom')} />
                    <span className="rte-image-handle is-right" onPointerDown={beginResize('right')} />
                </>
            )}
        </NodeViewWrapper>
    );
}

// The language is stored in the markdown fence info string (```js) and goes to
// data-language to show the label in the top-right corner of the code block.
const CodeBlockWithLanguage = CodeBlockLowlight.extend({
    renderHTML({ node, HTMLAttributes }) {
        return [
            'pre',
            mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
                'data-language': node.attrs.language || '',
            }),
            [
                'code',
                { class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null },
                0,
            ],
        ];
    },
});

// Attachment — a relative link to a file that actually sits next to the .md
// (the list comes from the backend). External links (http, mailto, #, /) stay regular.
// Markdown is not modified — the chip is derived from href on the fly.
const AttachmentLink = Link.extend({
    renderHTML(args) {
        const rendered = this.parent?.(args) ?? ['a', args.HTMLAttributes, 0];
        const [tag, attrs, ...rest] = rendered;
        if (isAttachmentHref(args.HTMLAttributes?.href)) {
            attrs.class = `${attrs.class ? `${attrs.class} ` : ''}rte-attachment`;
        }
        return [tag, attrs, ...rest];
    },
});

function createImageExtension(resolveAsset) {
    return Image.extend({
        addOptions() {
            return {
                ...this.parent?.(),
                resolveAsset,
            };
        },
        addAttributes() {
            return {
                ...this.parent?.(),
                width: {
                    default: null,
                    parseHTML: (el) => {
                        const value = el.getAttribute('width');
                        return value ? parseInt(value, 10) || null : null;
                    },
                },
                height: {
                    default: null,
                    parseHTML: (el) => {
                        const value = el.getAttribute('height');
                        return value ? parseInt(value, 10) || null : null;
                    },
                },
                src: {
                    default: null,
                    parseHTML: (el) => splitSizeFragment(el.getAttribute('src') || '').src,
                },
            };
        },
        parseMarkdown: (token, helpers) => {
            const { src, width, height } = splitSizeFragment(token.href || '');
            return helpers.createNode('image', {
                src,
                title: token.title || null,
                alt: token.text,
                width,
                height,
            });
        },
        renderMarkdown: (node) => {
            const src = (node.attrs.src || '').replace(/ /g, '%20');
            const alt = (node.attrs.alt || '').replace(/\\|\[|]/g, '\\$&');
            const title = (node.attrs.title || '').replace(/\\|"/g, '\\$&');
            const fragment = sizeFragment(node.attrs.width, node.attrs.height);
            const href = fragment ? `${src}#${fragment}` : src;
            return title ? `![${alt}](${href} "${title}")` : `![${alt}](${href})`;
        },
        addNodeView() {
            return ReactNodeViewRenderer(ImageView);
        },
    });
}

export function buildExtensions({ placeholder, resolveAsset } = {}) {
    return [
        StarterKit.configure({
            // Markdown has no underline — do not allow an unsaved style.
            underline: false,
            // Code block comes from CodeBlockLowlight (with language and highlighting).
            codeBlock: false,
            // Links — via our own implementation (AttachmentLink) to render attachments as a chip.
            link: false,
        }),
        AttachmentLink.configure({
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
            validate: isSafeLinkHref,
        }),
        Markdown.configure({
            markedOptions: { gfm: true },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: false } }),
        // Tab in a code block inserts 2 spaces instead of moving focus
        // (Shift-Tab outdents).
        CodeBlockWithLanguage.configure({ lowlight, enableTabIndentation: true, tabSize: 2 }),
        LinkShortcut,
        HeadingShortcut,
        StrikeShortcut,
        FormattingShortcut,
        ListShortcut,
        createImageExtension(resolveAsset),
        Placeholder.configure({
            placeholder: placeholder || 'Start typing…',
        }),
    ];
}
