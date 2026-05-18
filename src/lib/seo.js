// src/lib/seo.js
// ─────────────────────────────────────────────────────────────────────────────
// Helpers SEO basiques pour SPA :
//   - useDocumentTitle(title) : modifie <title> + le restore au demontage
//   - useMetaDescription(desc) : idem pour <meta name="description">
//   - useJsonLd(obj) : ajoute un <script type="application/ld+json"> dynamique
//   - useCanonical(url) : pose un <link rel="canonical">
//
// Usage minimal dans une page :
//   import { useDocumentTitle } from '../lib/seo';
//   useDocumentTitle(product ? `${product.name} · YARAM` : 'YARAM');
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';

const DEFAULT_TITLE = 'YARAM · Beauté pour ta peau africaine';
const DEFAULT_DESC = 'YARAM · Marketplace beauté avec IA dermatologique pour la peau africaine. Diagnostic peau gratuit, produits adaptés, livraison rapide à Dakar.';

export function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev || DEFAULT_TITLE; };
  }, [title]);
}

function setOrCreateMeta(selector, attr, name, value) {
  let el = document.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  const prev = el.getAttribute('content');
  el.setAttribute('content', value);
  return prev;
}

export function useMetaDescription(desc) {
  useEffect(() => {
    if (!desc) return;
    const prev = setOrCreateMeta('meta[name="description"]', 'name', 'description', desc);
    return () => {
      const el = document.querySelector('meta[name="description"]');
      if (el) el.setAttribute('content', prev || DEFAULT_DESC);
    };
  }, [desc]);
}

export function useCanonical(url) {
  useEffect(() => {
    if (!url) return;
    let el = document.querySelector('link[rel="canonical"]');
    let created = false;
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
      created = true;
    }
    const prev = el.getAttribute('href');
    el.setAttribute('href', url);
    return () => {
      if (created) el.remove();
      else if (prev) el.setAttribute('href', prev);
    };
  }, [url]);
}

// Injecte un <script type="application/ld+json">{...}</script> dans <head>
// et le retire au demontage. Le `key` (default = json stringify) sert d'identifiant
// pour ne pas inserer 2 fois la meme balise.
export function useJsonLd(obj, key = null) {
  useEffect(() => {
    if (!obj) return;
    const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const id = 'yaram-ld-' + (key || Math.random().toString(36).slice(2, 8));
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    el.text = json;
    document.head.appendChild(el);
    return () => { try { el.remove(); } catch { /* ignore */ } };
  }, [obj, key]);
}

// Helper rapide pour mettre title + description + canonical en une seule ligne
export function usePageSEO({ title, description, canonical }) {
  useDocumentTitle(title);
  useMetaDescription(description);
  useCanonical(canonical);
}
