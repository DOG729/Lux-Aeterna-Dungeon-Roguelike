'use strict';

export async function api(method, url, body) {
  if (window.electronAPI) {
    return window.electronAPI.invoke(url, method, body);
  }
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}
