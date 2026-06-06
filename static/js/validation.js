/**
 * HIRE XA — shared input validation / restriction
 * ===============================================
 * One consistent layer for "only relevant characters belong in this field".
 *
 * Declarative usage — add a data-validate type to any <input>/<textarea>:
 *     <input type="text"  data-validate="name">
 *     <input type="tel"   data-validate="phone">
 *     <input type="email" data-validate="email">
 * Optionally mark it required for blur-time messaging: data-required="true".
 *
 * Behaviour:
 *   - Blocks disallowed characters AS THE USER TYPES (and on paste/drop), so a
 *     phone field can't hold letters and a name field can't hold digits.
 *   - On blur, checks the full format and shows a red border + inline message.
 *   - Empty optional fields never show an error (the form's own "required"
 *     handling owns that).
 *
 * Imperative API (window.HXAValidate):
 *   attach(el, type)        wire a field created after load
 *   check(el[, show])       validate one field, returns true/false
 *   validateAll(container)  validate every wired field inside container;
 *                           returns { valid, firstInvalid }
 *
 * Self-contained: injects its own CSS, auto-wires [data-validate] on load.
 */
(function () {
    'use strict';

    // Each type: `strip` removes disallowed chars on input (null = no stripping,
    // e.g. email where we only block whitespace); `ok` is the full-value check;
    // `msg` is shown on blur when invalid.
    var TYPES = {
        // People names — letters (any script), spaces, . ' - only. No digits.
        name: {
            strip: /[^\p{L}\s.'\-]/gu,
            ok: function (v) { return /\p{L}/u.test(v) && v.trim().length >= 2; },
            msg: 'Enter a valid name (letters only).'
        },
        // City / state / location — letters + , . & ' - and spaces. No digits.
        city: {
            strip: /[^\p{L}\s,.&'\-]/gu,
            ok: function (v) { return v.trim().length >= 2; },
            msg: 'Enter a valid location.'
        },
        // Company name — letters + digits (e.g. "3M", "Tech4U") + & . , ' - / ( ).
        company: {
            strip: /[^\p{L}\p{N}\s&.,'\-/()]/gu,
            ok: function (v) { return /\p{L}/u.test(v) && v.trim().length >= 2; },
            msg: 'Enter a valid company name.'
        },
        // Job title / role — letters + digits ("L2", "AI/ML") + & . , ' - / ( ) + #.
        jobtitle: {
            strip: /[^\p{L}\p{N}\s&.,'\-/()+#]/gu,
            ok: function (v) { return /\p{L}/u.test(v) && v.trim().length >= 2; },
            msg: 'Enter a valid job title.'
        },
        // Phone — digits plus + ( ) - . and spaces; 7–15 digits overall.
        phone: {
            strip: /[^\d+\s().\-]/g,
            ok: function (v) {
                var digits = (v.match(/\d/g) || []).length;
                return digits >= 7 && digits <= 15 && /^[+]?[\d\s().\-]+$/.test(v);
            },
            msg: 'Enter a valid phone number.'
        },
        // Mobile — exactly 10 digits, nothing else (no country code/symbols).
        // Pair with maxlength="10" so it can't grow past 10 digits as you type.
        mobile: {
            strip: /\D/g,
            ok: function (v) { return /^\d{10}$/.test(v); },
            msg: 'Enter a 10-digit mobile number.'
        },
        // Email — block whitespace only while typing; full format on blur.
        email: {
            strip: /\s/g,
            ok: function (v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); },
            msg: 'Enter a valid email address.'
        },
        // Whole numbers only (budgets, counts).
        integer: {
            strip: /[^\d]/g,
            ok: function (v) { return /^\d+$/.test(v); },
            msg: 'Numbers only.'
        },
        // Numbers with an optional single decimal point.
        decimal: {
            strip: /[^\d.]/g,
            ok: function (v) { return /^\d+(\.\d+)?$/.test(v); },
            msg: 'Numbers only.'
        },
        // Website / URL.
        url: {
            strip: /\s/g,
            ok: function (v) { return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(v); },
            msg: 'Enter a valid website URL.'
        }
    };

    function injectCSS() {
        if (document.getElementById('hxa-validate-css')) return;
        var s = document.createElement('style');
        s.id = 'hxa-validate-css';
        s.textContent =
            '.hxa-invalid{border-color:#E2574C !important;box-shadow:0 0 0 1px rgba(226,87,76,.25) !important;}' +
            '.hxa-field-err{display:block;margin-top:5px;font-family:"Lexend Deca",sans-serif;' +
            'font-weight:300;font-size:11px;line-height:1.35;color:#E2574C;}';
        (document.head || document.documentElement).appendChild(s);
    }

    // Strip disallowed characters while preserving the caret position.
    function sanitize(el, stripRe) {
        var before = el.value;
        if (!before) return;
        var start = el.selectionStart;
        var cleaned = before.replace(stripRe, '');
        if (cleaned === before) return;
        // How many chars survive to the left of the caret → new caret position.
        var leftKept = before.slice(0, start).replace(stripRe, '').length;
        el.value = cleaned;
        try { el.setSelectionRange(leftKept, leftKept); } catch (e) { /* number inputs throw */ }
    }

    function errEl(el, create) {
        if (el._hxaErr) return el._hxaErr;
        if (!create) return null;
        var span = document.createElement('span');
        span.className = 'hxa-field-err';
        // Append within the field's container so we don't sit between an input
        // and its (often absolutely-positioned) decorative icon.
        (el.parentNode || el).appendChild(span);
        el._hxaErr = span;
        return span;
    }

    function setErr(el, msg) {
        el.classList.add('hxa-invalid');
        el.setAttribute('aria-invalid', 'true');
        var e = errEl(el, true);
        if (e) e.textContent = msg || '';
    }

    function clearErr(el) {
        el.classList.remove('hxa-invalid');
        el.removeAttribute('aria-invalid');
        if (el._hxaErr) el._hxaErr.textContent = '';
    }

    function isRequired(el) {
        return el.required || el.dataset.required === 'true' || el.getAttribute('aria-required') === 'true';
    }

    function check(el, show) {
        var cfg = TYPES[el._hxaType];
        if (!cfg) return true;
        var v = el.value || '';
        var empty = v.trim() === '';
        var ok = empty ? !isRequired(el) : cfg.ok(v);
        if (ok) {
            clearErr(el);
        } else if (show !== false) {
            setErr(el, empty ? 'This field is required.' : cfg.msg);
        }
        return ok;
    }

    function attach(el, type) {
        if (!el || el._hxaAttached) return;
        var cfg = TYPES[type];
        if (!cfg) return;
        el._hxaAttached = true;
        el._hxaType = type;

        if (type === 'phone' || type === 'mobile' || type === 'integer' || type === 'decimal') {
            el.setAttribute('inputmode', (type === 'phone' || type === 'mobile') ? 'tel' : 'numeric');
        }
        // A mobile is always capped at 10 digits — set it here so callers can't
        // forget the attribute (the strip keeps it digits-only).
        if (type === 'mobile' && !el.hasAttribute('maxlength')) {
            el.setAttribute('maxlength', '10');
        }

        el.addEventListener('input', function () {
            if (cfg.strip) sanitize(el, cfg.strip);
            // While typing, only relax an already-shown error (don't pop a new
            // one mid-entry) — full validation happens on blur.
            if (el.classList.contains('hxa-invalid')) check(el, true);
        });
        el.addEventListener('blur', function () { check(el, true); });
    }

    function validateAll(container) {
        var root = container || document;
        var fields = root.querySelectorAll('[data-validate]');
        var firstInvalid = null;
        for (var i = 0; i < fields.length; i++) {
            var el = fields[i];
            if (!el._hxaAttached) attach(el, el.dataset.validate);
            if (el.offsetParent === null && el.type !== 'hidden') continue; // skip hidden fields
            if (!check(el, true) && !firstInvalid) firstInvalid = el;
        }
        return { valid: !firstInvalid, firstInvalid: firstInvalid };
    }

    function init() {
        injectCSS();
        var fields = document.querySelectorAll('[data-validate]');
        for (var i = 0; i < fields.length; i++) attach(fields[i], fields[i].dataset.validate);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.HXAValidate = { attach: attach, check: check, validateAll: validateAll, TYPES: TYPES };
})();
