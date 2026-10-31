/* Admin panel: AJAX forms, sorting, repeaters, media & icon pickers, rich text, live preview, theme editor. */
(() => {
    'use strict';

    const A = window.ADMIN || {};
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ICON = {
        check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
        alert: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
    };

    /* ---------- Toasts ---------- */
    const toast = (message, type = 'success') => {
        if (!message) return;
        const box = $('#toasts');
        const el = document.createElement('div');
        el.className = 'toast is-' + type;
        el.innerHTML = (type === 'error' ? ICON.alert : ICON.check) + '<span>' + esc(message) + '</span>';
        box.appendChild(el);
        setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 320); }, type === 'error' ? 6500 : 3800);
    };
    (A.flashes || []).forEach(f => toast(f.message, f.type === 'error' ? 'error' : (f.type === 'info' ? 'info' : 'success')));

    /* ---------- Requests ---------- */
    const request = async (url, body) => {
        const res = await fetch(url, {
            method: 'POST',
            body,
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': A.csrf, Accept: 'application/json' },
            credentials: 'same-origin',
        });
        let data;
        try { data = await res.json(); } catch (e) { data = { ok: false, message: res.status === 413 ? 'The file is too large for the server.' : 'Unexpected server response (' + res.status + ').' }; }
        data.status = res.status;
        if (res.status === 401) { toast('Your session has ended. Please sign in again.', 'error'); setTimeout(() => location.reload(), 1500); }
        if (res.status === 419) toast('This page has expired. Please refresh it.', 'error');
        return data;
    };
    const post = (url, fields = {}) => {
        const fd = new FormData();
        fd.append('_token', A.csrf);
        Object.entries(fields).forEach(([k, v]) => Array.isArray(v) ? v.forEach(x => fd.append(k + '[]', x)) : fd.append(k, v));
        return request(url, fd);
    };

    /* ---------- Sidebar ---------- */
    const sidebar = $('#sidebar');
    $('[data-sidebar-toggle]')?.addEventListener('click', () => sidebar.classList.toggle('is-open'));
    $('[data-sidebar-close]')?.addEventListener('click', () => sidebar.classList.remove('is-open'));

    /* ---------- Live preview ---------- */
    const preview = (() => {
        const wrap = $('[data-preview]');
        if (!wrap) return null;
        const stage = $('[data-preview-stage]', wrap);
        const frame = $('[data-preview-frame]', wrap);
        const widths = { desktop: 1440, tablet: 820, mobile: 390 };
        let device = 'desktop';
        let pendingScroll = frame.dataset.section ? { section: frame.dataset.section } : null;
        let extra = null;

        const fit = () => {
            const w = widths[device];
            const sw = stage.clientWidth - (device === 'desktop' ? 0 : 24);
            const scale = Math.min(1, sw / w);
            frame.style.width = w + 'px';
            frame.style.height = (stage.clientHeight / scale) + 'px';
            frame.style.transform = `translateX(-50%) scale(${scale})`;
            frame.style.top = device === 'desktop' ? '0' : '12px';
        };
        const send = msg => { try { frame.contentWindow.postMessage(msg, location.origin); } catch (e) { /* not ready */ } };
        const reload = (opts = {}) => {
            let y = 0;
            try { y = frame.contentWindow.scrollY; } catch (e) { y = 0; }
            pendingScroll = opts.section ? { section: opts.section } : { y };
            stage.classList.add('is-loading');
            frame.contentWindow.location.reload();
        };
        frame.addEventListener('load', () => {
            stage.classList.remove('is-loading');
            if (!pendingScroll) return;
            const target = pendingScroll;
            pendingScroll = null;
            setTimeout(() => {
                if (target.section) send({ type: 'scroll-to', id: target.section, offset: 0 });
                else try { frame.contentWindow.scrollTo(0, target.y); } catch (e) { /* ignore */ }
                if (extra) extra();
            }, 350);
        });
        $$('[data-device]', wrap).forEach(b => b.addEventListener('click', () => {
            device = b.dataset.device;
            $$('[data-device]', wrap).forEach(x => x.classList.toggle('is-active', x === b));
            fit();
        }));
        $('[data-preview-reload]', wrap)?.addEventListener('click', () => reload());
        const side = wrap.closest('.split-preview');
        $('[data-preview-open]')?.addEventListener('click', () => { side?.classList.add('is-open'); requestAnimationFrame(fit); });
        $('[data-preview-close]', wrap)?.addEventListener('click', () => side?.classList.remove('is-open'));
        addEventListener('resize', fit);
        new ResizeObserver(fit).observe(stage);
        fit();
        return { reload, send, onLoad: fn => { extra = fn; } };
    })();

    /* ---------- Dirty guard ---------- */
    let dirtyForm = null;
    const setDirty = (form, dirty) => {
        const state = $('[data-save-state]', form);
        if (state) { state.textContent = dirty ? 'Unsaved changes' : ''; state.classList.toggle('is-dirty', dirty); }
        dirtyForm = dirty ? form : (dirtyForm === form ? null : dirtyForm);
    };
    $$('form[data-dirty-guard]').forEach(form => {
        form.addEventListener('input', () => setDirty(form, true));
        form.addEventListener('change', () => setDirty(form, true));
    });
    addEventListener('beforeunload', e => { if (dirtyForm) { e.preventDefault(); e.returnValue = ''; } });

    /* ---------- AJAX forms ---------- */
    const clearErrors = form => {
        $$('.has-error', form).forEach(f => f.classList.remove('has-error'));
        $$('.f-error', form).forEach(p => { p.textContent = ''; });
    };
    const showErrors = (form, errors) => {
        Object.entries(errors || {}).forEach(([name, msg]) => {
            const field = $(`[data-field="${CSS.escape(name)}"]`, form);
            if (!field) return;
            field.classList.add('has-error');
            const p = $('.f-error', field);
            if (p) p.textContent = msg;
        });
        $('.has-error', form)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const syncEditors = form => $$('[data-rte]', form).forEach(rte => { $('textarea', rte).value = $('.rte-body', rte).innerHTML.trim(); });

    $$('form[data-ajax]').forEach(form => {
        form.addEventListener('submit', async e => {
            e.preventDefault();
            syncEditors(form);
            clearErrors(form);
            const button = e.submitter || $('button[type="submit"]', form);
            button?.classList.add('is-loading');
            try {
                const data = await request(form.action, new FormData(form));
                if (data.ok) {
                    setDirty(form, false);
                    if (data.redirect) { toast(data.message); setTimeout(() => { location.href = data.redirect; }, 450); return; }
                    toast(data.message);
                    if (form.dataset.previewRefresh && preview) preview.reload({ section: form.dataset.previewRefresh });
                    else if (preview) preview.reload();
                    if (data.status && $('[data-status-badge]')) {
                        const badge = $('[data-status-badge]');
                        badge.className = 'badge badge-' + data.status;
                        badge.textContent = data.label;
                    }
                    if (data.slug) $$('[data-article-link]').forEach(a => { a.href = A.base + '/articles/' + data.slug; });
                    $$('input[type="password"]', form).forEach(p => { p.value = ''; });
                } else {
                    showErrors(form, data.errors);
                    toast(data.message || 'Something went wrong.', 'error');
                }
            } catch (err) {
                toast('Could not reach the server. Check your connection.', 'error');
            } finally {
                button?.classList.remove('is-loading');
            }
        });
    });

    /* ---------- Buttons that POST (delete, duplicate, backup, test email) ---------- */
    document.addEventListener('click', async e => {
        const btn = e.target.closest('[data-post]');
        if (!btn) return;
        e.preventDefault();
        if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
        btn.classList.add('is-loading');
        try {
            const data = await post(btn.dataset.post);
            if (data.ok) {
                dirtyForm = null;
                toast(data.message);
                if (data.redirect) setTimeout(() => { location.href = data.redirect; }, 400);
            } else {
                toast(data.message || 'Action failed.', 'error');
            }
        } finally {
            btn.classList.remove('is-loading');
        }
    });

    /* ---------- Visibility switches ---------- */
    document.addEventListener('change', async e => {
        const input = e.target.closest('[data-toggle-url]');
        if (!input) return;
        const data = await post(input.dataset.toggleUrl);
        if (data.ok) {
            input.checked = !!data.active;
            input.closest('.sec-item, .row')?.classList.toggle('is-off', !data.active);
            toast(data.message);
            preview?.reload();
        } else {
            input.checked = !input.checked;
            toast(data.message || 'Could not change visibility.', 'error');
        }
    });

    /* ---------- Drag to reorder (mouse and touch) ---------- */
    const sortable = (container, itemSel, onEnd) => {
        let dragging = null;
        container.addEventListener('pointerdown', e => {
            const handle = e.target.closest('[data-drag-handle]');
            if (!handle) return;
            const item = handle.closest(itemSel);
            if (!item || item.parentElement !== container) return;
            e.preventDefault();
            dragging = item;
            item.classList.add('is-dragging');
            handle.setPointerCapture(e.pointerId);
            const move = ev => {
                const siblings = Array.from(container.children).filter(c => c !== dragging && c.matches(itemSel));
                const after = siblings.find(s => { const r = s.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
                siblings.forEach(s => s.classList.remove('drag-over'));
                if (after) { after.classList.add('drag-over'); container.insertBefore(dragging, after); }
                else container.appendChild(dragging);
            };
            const up = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                $$('.drag-over', container).forEach(s => s.classList.remove('drag-over'));
                dragging.classList.remove('is-dragging');
                dragging = null;
                onEnd();
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        });
    };
    $$('[data-sortable]').forEach(list => {
        let before = '';
        const order = () => $$(':scope > [data-id]', list).map(li => li.dataset.id);
        list.addEventListener('pointerdown', () => { before = order().join(','); }, true);
        sortable(list, '[data-id]', async () => {
            const ids = order();
            if (ids.join(',') === before) return;
            const data = await post(list.dataset.sortable, { ids });
            toast(data.ok ? data.message : (data.message || 'Could not save the order.'), data.ok ? 'success' : 'error');
            if (data.ok) preview?.reload();
        });
    });

    /* ---------- Repeaters ---------- */
    let repCounter = Date.now() % 100000;
    const repLabel = item => {
        const input = $('.rep-body input[type="text"], .rep-body textarea', item);
        const label = $('[data-rep-label]', item);
        if (label) label.textContent = (input && input.value.trim()) ? input.value.trim().slice(0, 60) : 'New item';
    };
    $$('[data-repeater]').forEach(rep => {
        const items = $('[data-rep-items]', rep);
        const tpl = $('[data-rep-template]', rep);
        const max = parseInt(rep.dataset.max, 10) || 60;
        $$('[data-rep-item]', items).forEach(it => { if ($$('[data-rep-item]', items).length > 3) it.classList.add('is-collapsed'); });
        $('[data-rep-add]', rep).addEventListener('click', () => {
            if ($$(':scope > [data-rep-item]', items).length >= max) { toast('You have reached the maximum number of items.', 'error'); return; }
            const html = tpl.innerHTML.replace(/__i__/g, 'n' + (repCounter++));
            const wrap = document.createElement('div');
            wrap.innerHTML = html.trim();
            const item = wrap.firstElementChild;
            items.appendChild(item);
            $('input, textarea', item)?.focus();
            items.closest('form')?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        sortable(items, '[data-rep-item]', () => items.closest('form')?.dispatchEvent(new Event('input', { bubbles: true })));
    });
    document.addEventListener('click', e => {
        const item = e.target.closest('[data-rep-item]');
        if (!item) return;
        if (e.target.closest('[data-rep-remove]')) {
            const form = item.closest('form');
            item.remove();
            form?.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (e.target.closest('[data-rep-up]')) {
            const prev = item.previousElementSibling;
            if (prev) { item.parentElement.insertBefore(item, prev); item.closest('form')?.dispatchEvent(new Event('input', { bubbles: true })); }
        } else if (e.target.closest('[data-rep-toggle]')) {
            item.classList.toggle('is-collapsed');
        }
    });
    document.addEventListener('input', e => { const item = e.target.closest('[data-rep-item]'); if (item) repLabel(item); });

    /* ---------- Small field helpers ---------- */
    document.addEventListener('input', e => {
        const range = e.target.closest('[data-range] input[type="range"]');
        if (range) {
            const out = $('output', range.closest('[data-range]'));
            if (out) out.textContent = range.value + out.textContent.replace(/^[\d.]+/, '');
        }
        const color = e.target.closest('[data-color] input');
        if (color) {
            const box = color.closest('[data-color]');
            const picker = $('input[type="color"]', box);
            const text = $('input[type="text"]', box);
            if (color === picker) text.value = picker.value;
            else if (/^#[0-9a-f]{6}$/i.test(text.value.trim())) picker.value = text.value.trim();
        }
    });
    $('[data-jump]')?.addEventListener('change', e => { location.href = e.target.value; });
    $$('[data-filter]').forEach(input => input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        $$(input.dataset.filter).forEach(el => { el.hidden = q !== '' && !el.textContent.toLowerCase().includes(q); });
    }));
    document.addEventListener('click', e => {
        const row = e.target.closest('tr[data-href]');
        if (row && !e.target.closest('a, button, input, label')) location.href = row.dataset.href;
        const copy = e.target.closest('[data-copy]');
        if (copy) {
            navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Link copied.'), () => toast(copy.dataset.copy, 'info'));
        }
    });

    /* ---------- Media picker ---------- */
    const mediaModal = $('#media-modal');
    let mediaCache = null;
    let mediaCallback = null;
    let mediaType = 'image';
    const loadMedia = async (force = false) => {
        if (mediaCache && !force) return mediaCache;
        const res = await fetch(A.mediaList, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' });
        mediaCache = (await res.json()).items || [];
        return mediaCache;
    };
    const renderMedia = () => {
        const grid = $('[data-media-grid]', mediaModal);
        const list = (mediaCache || []).filter(m => mediaType === 'video' ? m.video : !m.video);
        if (!list.length) { grid.innerHTML = '<p class="muted">No ' + mediaType + 's yet. Use Upload to add one.</p>'; return; }
        grid.innerHTML = list.map(m => `<button type="button" data-pick-media="${esc(m.path)}" data-url="${esc(m.url)}">${m.video
            ? `<div class="m-thumb"><video src="${esc(m.url)}" muted preload="metadata"></video></div>`
            : `<div class="m-thumb"><img src="${esc(m.url)}" alt="" loading="lazy"></div>`}<span>${esc(m.name)}</span></button>`).join('');
    };
    const openMedia = async (type, callback) => {
        mediaType = type;
        mediaCallback = callback;
        $('#media-modal-title').textContent = type === 'video' ? 'Choose a video' : 'Choose a photo';
        mediaModal.showModal();
        await loadMedia();
        renderMedia();
    };
    const uploadFiles = async files => {
        if (!files.length) return [];
        const fd = new FormData();
        Array.from(files).forEach(f => fd.append('file[]', f));
        toast('Uploading ' + files.length + ' file(s)…', 'info');
        const data = await request(A.mediaUpload, fd);
        if (!data.ok) { toast(data.message, 'error'); return []; }
        toast(data.message);
        mediaCache = (data.items || []).concat(mediaCache || []);
        return data.items || [];
    };
    if (mediaModal) {
        mediaModal.addEventListener('click', e => {
            if (e.target === mediaModal || e.target.closest('[data-modal-close]')) { mediaModal.close(); return; }
            const pick = e.target.closest('[data-pick-media]');
            if (pick) { mediaCallback?.(pick.dataset.pickMedia, pick.dataset.url); mediaModal.close(); }
        });
        $('[data-media-upload]', mediaModal).addEventListener('change', async e => {
            await uploadFiles(e.target.files);
            e.target.value = '';
            renderMedia();
        });
    }
    const setPicker = (picker, path, url) => {
        const input = $('input[type="hidden"]', picker);
        input.value = path;
        const box = $('.picker-preview', picker);
        $$('img, video', box).forEach(n => n.remove());
        if (path) {
            const node = document.createElement(picker.dataset.type === 'video' ? 'video' : 'img');
            node.src = url;
            if (node.tagName === 'VIDEO') node.muted = true; else node.alt = '';
            box.prepend(node);
        }
        $('[data-picker-path]', picker).textContent = path ? path.split('/').pop() : '';
        picker.classList.toggle('has-value', !!path);
        picker.closest('form')?.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.addEventListener('click', e => {
        const picker = e.target.closest('[data-picker]');
        if (!picker) return;
        if (e.target.closest('[data-clear]')) { setPicker(picker, '', ''); return; }
        if (e.target.closest('[data-pick]')) openMedia(picker.dataset.type, (path, url) => setPicker(picker, path, url));
    });

    /* ---------- Media library page ---------- */
    const library = $('[data-library]');
    if (library) {
        const zone = $('[data-dropzone]');
        const addItems = items => {
            $('[data-empty]')?.remove();
            items.forEach(m => {
                const fig = document.createElement('figure');
                fig.className = 'm-item';
                fig.dataset.mediaItem = '';
                fig.innerHTML = `<div class="m-thumb">${m.video ? `<video src="${esc(m.url)}" muted preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="">`}</div>
                    <figcaption><strong title="${esc(m.name)}">${esc(m.name)}</strong><small>${esc([m.size, m.dims].filter(Boolean).join(' · '))}</small></figcaption>
                    <div class="m-actions"><button type="button" class="icon-btn sm danger" data-media-delete="${esc(A.base)}/admin/media/${m.id}/delete" aria-label="Delete">✕</button></div>`;
                library.prepend(fig);
            });
        };
        $('[data-media-upload]', zone).addEventListener('change', async e => { addItems(await uploadFiles(e.target.files)); e.target.value = ''; });
        ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, ev => { ev.preventDefault(); zone.classList.add('is-drag'); }));
        ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, () => zone.classList.remove('is-drag')));
        zone.addEventListener('drop', async ev => { ev.preventDefault(); addItems(await uploadFiles(ev.dataTransfer.files)); });
        library.addEventListener('click', async e => {
            const del = e.target.closest('[data-media-delete]');
            if (!del) return;
            if (!confirm('Delete this file permanently?')) return;
            let data = await post(del.dataset.mediaDelete);
            if (!data.ok && data.used) {
                if (!confirm('This file is still used here:\n\n• ' + data.used.join('\n• ') + '\n\nDelete it anyway? Those places will show no image.')) return;
                data = await post(del.dataset.mediaDelete, { force: 1 });
            }
            if (data.ok) { del.closest('[data-media-item]').remove(); toast(data.message); }
            else toast(data.message || 'Could not delete the file.', 'error');
        });
    }

    /* ---------- Icon picker ---------- */
    const pop = $('#icon-pop');
    let iconTarget = null;
    if (pop) {
        const grid = $('[data-icon-grid]', pop);
        const search = $('[data-icon-search]', pop);
        grid.innerHTML = Object.entries(A.icons || {}).map(([name, i]) => `<button type="button" data-icon="${esc(name)}" title="${esc(i.label)}" data-label="${esc(i.label.toLowerCase() + ' ' + name)}">${i.svg}</button>`).join('');
        const close = () => { pop.hidden = true; iconTarget = null; };
        document.addEventListener('click', e => {
            const btn = e.target.closest('[data-icon-picker]');
            if (btn) {
                e.preventDefault();
                iconTarget = btn;
                const r = btn.getBoundingClientRect();
                pop.hidden = false;
                const top = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 10);
                pop.style.top = Math.max(10, top) + 'px';
                pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 10) + 'px';
                const current = $('input', btn).value;
                $$('button', grid).forEach(b => b.classList.toggle('is-active', b.dataset.icon === current));
                search.value = '';
                $$('button', grid).forEach(b => { b.hidden = false; });
                search.focus();
                return;
            }
            const choice = e.target.closest('[data-icon]');
            if (choice && iconTarget) {
                const name = choice.dataset.icon;
                $('input', iconTarget).value = name;
                $('.ip-svg', iconTarget).innerHTML = A.icons[name].svg;
                $('.ip-label', iconTarget).textContent = A.icons[name].label;
                iconTarget.closest('form')?.dispatchEvent(new Event('input', { bubbles: true }));
                close();
                return;
            }
            if (!e.target.closest('#icon-pop')) close();
        });
        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            $$('button', grid).forEach(b => { b.hidden = q !== '' && !b.dataset.label.includes(q); });
        });
        addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
        addEventListener('scroll', () => { if (!pop.hidden) close(); }, { passive: true });
    }

    /* ---------- Rich text editor ---------- */
    $$('[data-rte]').forEach(rte => {
        const body = $('.rte-body', rte);
        const area = $('textarea', rte);
        const sync = () => { area.value = body.innerHTML.trim(); };
        $('.rte-bar', rte).addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
        $('.rte-bar', rte).addEventListener('click', e => {
            const b = e.target.closest('button[data-cmd]');
            if (!b) return;
            body.focus();
            const cmd = b.dataset.cmd;
            if (cmd === 'createLink') {
                const url = prompt('Link address (https://…)', 'https://');
                if (url && /^(https?:|mailto:|tel:|#|\/)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
            } else if (cmd === 'insertImage') {
                const range = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
                openMedia('image', (path, url) => {
                    body.focus();
                    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
                    document.execCommand('insertImage', false, url);
                    sync();
                });
            } else if (cmd === 'formatBlock') {
                document.execCommand('formatBlock', false, `<${b.dataset.arg}>`);
            } else {
                document.execCommand(cmd, false, null);
            }
            sync();
        });
        body.addEventListener('input', sync);
        body.addEventListener('paste', e => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text/plain');
            if (text === undefined) return;
            e.preventDefault();
            document.execCommand('insertText', false, text);
        });
    });

    /* ---------- Auto slug hint for articles ---------- */
    const titleInput = $('input[name="data[title]"]');
    const slugInput = $('input[name="data[slug]"]');
    if (titleInput && slugInput && !slugInput.value) {
        titleInput.addEventListener('input', () => {
            slugInput.placeholder = titleInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
        });
    }

    /* ---------- Theme editor with instant preview ---------- */
    const themeForm = $('[data-theme-form]');
    if (themeForm) {
        const FONTS = window.THEME_FONTS || {};
        const sample = $('[data-type-sample]');
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);

        const val = name => themeForm.querySelector(`[name="${name}"]`);
        const fontsUrl = names => 'https://fonts.googleapis.com/css2?' + [...new Set(names)].filter(n => FONTS[n])
            .map(n => 'family=' + n.replace(/ /g, '+') + (FONTS[n].spec ? ':' + FONTS[n].spec : '')).join('&') + '&display=swap';
        const stack = n => `'${n}', ${(FONTS[n] || {}).fallback || 'serif'}`;

        const apply = () => {
            const vars = {};
            $$('[data-color-key]', themeForm).forEach(input => {
                if (/^#[0-9a-f]{3,8}$/i.test(input.value.trim())) vars['--' + input.dataset.colorKey.replace(/_/g, '-')] = input.value.trim();
            });
            const head = val('data[font_heading]').value, bodyF = val('data[font_body]').value, sign = val('data[font_signature]').value;
            vars['--font-head'] = stack(head);
            vars['--font-body'] = stack(bodyF);
            vars['--font-sign'] = stack(sign);
            vars['--head-weight'] = val('data[heading_weight]').value;
            const upper = $$('input[name="data[heading_uppercase][]"][type="checkbox"]', themeForm)[0]?.checked;
            vars['--head-case'] = upper ? 'uppercase' : 'none';
            vars['--head-spacing'] = upper ? '.04em' : '-.01em';
            const radius = parseInt(val('data[radius]').value, 10) || 0;
            vars['--radius'] = radius + 'px';
            const shape = themeForm.querySelector('input[name="data[button_shape]"]:checked')?.value || 'pill';
            vars['--btn-radius'] = shape === 'pill' ? '999px' : (shape === 'sharp' ? '0px' : Math.max(2, radius / 2) + 'px');

            const href = fontsUrl([head, bodyF, sign]);
            if (fontLink.href !== href) fontLink.href = href;
            if (sample) {
                $('.ts-head', sample).style.fontFamily = vars['--font-head'];
                $('.ts-head', sample).style.fontWeight = vars['--head-weight'];
                $('.ts-head', sample).style.textTransform = vars['--head-case'];
                $('.ts-body', sample).style.fontFamily = vars['--font-body'];
                $('.ts-sign', sample).style.fontFamily = vars['--font-sign'];
                sample.style.background = vars['--dark-bg'] || '';
                sample.style.borderRadius = vars['--radius'];
                $('.ts-head em', sample).style.color = vars['--gold'] || '';
                $('.ts-sign', sample).style.color = vars['--gold'] || '';
            }
            const classes = {};
            $$('[data-effect]', themeForm).forEach(cb => {
                if (['grain', 'cursor', 'reveal', 'parallax'].includes(cb.dataset.effect)) classes['fx-' + cb.dataset.effect] = cb.checked;
            });
            preview?.send({ type: 'theme-vars', vars });
            preview?.send({ type: 'theme-fonts', href });
            preview?.send({ type: 'body-class', classes });
        };

        $$('[data-preset]', themeForm).forEach(btn => btn.addEventListener('click', () => {
            const colors = JSON.parse(btn.dataset.colors);
            Object.entries(colors).forEach(([k, v]) => {
                const input = themeForm.querySelector(`[data-color-key="${k}"]`);
                if (!input) return;
                input.value = v;
                const picker = $('input[type="color"]', input.closest('[data-color]'));
                if (picker) picker.value = v;
            });
            $('[data-preset-input]', themeForm).value = btn.dataset.preset;
            $$('[data-preset]', themeForm).forEach(b => b.classList.toggle('is-active', b === btn));
            setDirty(themeForm, true);
            apply();
        }));
        themeForm.addEventListener('input', () => requestAnimationFrame(apply));
        themeForm.addEventListener('change', () => requestAnimationFrame(apply));
        preview?.onLoad(apply);
        apply();
    }
})();
