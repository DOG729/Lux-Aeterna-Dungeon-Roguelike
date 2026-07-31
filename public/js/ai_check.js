'use strict';
import { api }        from './api.js';
import { $, toast }   from './dom.js';
import { u }          from './i18n.js';
import { openSettings, setSettingsTab } from './settings.js';

let _checking = false;

function _showOverlay() { $('ai-check-overlay').classList.remove('hidden'); }
function _hideOverlay() { $('ai-check-overlay').classList.add('hidden'); }

// Gate before entering the game (new game / continue / load).
// Server caches a successful check for the process lifetime (per settings
// signature), so repeated entries during one session don't re-ping the AI.
export async function ensureAiReady() {
  if (_checking) return false;
  _checking = true;
  // Small threshold avoids a flash when the server answers from cache almost instantly
  const overlayTimer = setTimeout(_showOverlay, 120);
  try {
    const r = await api('POST', '/api/ai-check');
    clearTimeout(overlayTimer);
    _hideOverlay();
    if (r?.ok) return true;
    toast(r?.hint ?? u('html', 'ai_check_fail', '⚠️ AI недоступен. Настройте провайдера в настройках.'));
    await openSettings();
    setSettingsTab('provider');
    return false;
  } catch {
    clearTimeout(overlayTimer);
    _hideOverlay();
    toast(u('html', 'ai_check_fail', '⚠️ AI недоступен. Настройте провайдера в настройках.'));
    return false;
  } finally {
    _checking = false;
  }
}
