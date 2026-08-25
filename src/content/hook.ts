// src/content/hook.ts
(function () {
  const post = (data: string, url: string) => {
    window.postMessage({ type: 'OVERHEARD_DATA', data, url }, '*');
  };

  const getPlayer = () =>
    (document.getElementById('movie_player') || document.querySelector('.html5-video-player')) as any;

  // Reads the SAME raw caption metadata your original YoutubeAdapter parsed
// from ytInitialPlayerResponse on first load — but via the player's live
// getPlayerResponse(), which refreshes correctly on every SPA navigation.
// This is more reliable than getOption('captions','tracklist'), which
// reflects the captions UI module's reactive state and can lag or stay
// empty depending on playback lifecycle timing.
const getTracksFromPlayerResponse = (player: any): any[] => {
  try {
    const response = player.getPlayerResponse?.();
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return tracks || [];
  } catch {
    return [];
  }
};

// Polls for the player object itself, not just its tracklist. On a cold
// page load, the very first message can arrive before #movie_player even
// exists in the DOM yet — bailing immediately in that case meant only the
// outer retry (500ms later) had a chance to catch it, which wasn't always
// enough. Polling here catches it much faster and more reliably.
const waitForTracklist = async (maxAttempts = 12, delayMs = 300): Promise<any[]> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const player = getPlayer();
    if (player) {
      player.loadModule?.('captions');

      const rawTracks = getTracksFromPlayerResponse(player);
      if (rawTracks.length > 0) {
        const tracklist = rawTracks.map((t: any) => ({
          languageCode: t.languageCode,
          kind: t.kind,
          baseUrl: t.baseUrl,
        }));
        console.log(`[Overheard Hook] Tracks ready after attempt ${attempt}:`, tracklist.map((t: any) => t.languageCode));
        return tracklist;
      }

      const uiTracklist = player.getOption?.('captions', 'tracklist') || [];
      if (uiTracklist.length > 0) {
        console.log(`[Overheard Hook] Tracks ready via UI module after attempt ${attempt}:`, uiTracklist.map((t: any) => t.languageCode));
        return uiTracklist;
      }
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  console.warn('[Overheard Hook] No tracks found after', maxAttempts, 'attempts (player or tracklist never became ready)');
  return [];
};

  let pendingTranslation: { targetLangCode: string } | null = null;

  const buildTranslatedUrl = (baseUrl: string, targetLangCode: string) => {
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set('tlang', targetLangCode);
    return url.toString();
  };

  const originalFetch = window.fetch;

  const followUpWithTranslation = async (baseUrl: string, attempt = 1) => {
  if (!pendingTranslation) return;
  const { targetLangCode } = pendingTranslation;
  if (attempt === 1) pendingTranslation = null;

  const translatedUrl = buildTranslatedUrl(baseUrl, targetLangCode);
  try {
    const res = await originalFetch.call(window, translatedUrl, { credentials: 'include' });
    const text = await res.text();
    console.log(`[Overheard Hook] Direct translation fetch attempt=${attempt} status=${res.status} length=${text.length}`);

    if (text.length === 0 && attempt < 4) {
      setTimeout(() => {
        pendingTranslation = { targetLangCode };
        followUpWithTranslation(baseUrl, attempt + 1);
      }, 400 * attempt);
      return;
    }

    if (text.length === 0) {
      // Exhausted our own retries — tell index.tsx immediately instead of
      // letting its outer capture sit idle until ITS timeout fires on its
      // own. This is what was silently burning the full 8s previously.
      console.warn('[Overheard Hook] Translation fetch exhausted retries, signaling failure early');
      window.postMessage({ type: 'OVERHEARD_TRANSLATION_FAILED', url: translatedUrl }, '*');
      return;
    }

    post(text, translatedUrl);
  } catch (e) {
    console.warn('[Overheard Hook] Direct translation fetch failed', e);
    window.postMessage({ type: 'OVERHEARD_TRANSLATION_FAILED', url: translatedUrl }, '*');
  }
};

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_method: string, url: string | URL) {
    const urlString = typeof url === 'string' ? url : url.toString();
    if (urlString.includes('api/timedtext')) {
      this.addEventListener('load', () => {
        post(this.responseText, urlString);
        followUpWithTranslation(urlString);
      });
    }
    return originalOpen.apply(this, arguments as any);
  };

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    const response = await originalFetch.apply(this, args);
    if (url.includes('api/timedtext')) {
      response.clone().text().then(text => {
        post(text, url);
        followUpWithTranslation(url);
      });
    }
    return response;
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'OVERHEARD_GET_TRACKS') {
  const tracklist = await waitForTracklist();
  const tracks = tracklist.map((t: any) => ({
    languageCode: t.languageCode,
    isAutoGenerated: t.kind === 'asr',
  }));
  window.postMessage({ type: 'OVERHEARD_TRACKS', tracks }, '*');
  return;
}

    if (event.data.type === 'OVERHEARD_SET_PLAYER_LANG') {
  // waitForTracklist now also guarantees the player object itself exists
  // by the time we get here (it polls for both), so we don't need a
  // separate immediate getPlayer() null-check that could bail too early.
  const { sourceLangCode, isTranslation, targetLangCode } = event.data;
  const tracklist = await waitForTracklist();
  const player = getPlayer();

  if (!player || !player.setOption || tracklist.length === 0) {
    console.warn('[Overheard Hook] Player or tracklist never became ready for', sourceLangCode);
    return;
  }

  const sourceTrack = tracklist.find((t: any) => t.languageCode === sourceLangCode) || tracklist[0];
  if (!sourceTrack) {
    console.warn('[Overheard Hook] No source track found for', sourceLangCode);
    return;
  }

  pendingTranslation = (isTranslation && targetLangCode) ? { targetLangCode } : null;

  player.setOption('captions', 'track', {});
  player.setOption('captions', 'track', sourceTrack);
  console.log(
    '[Overheard Hook] Base track requested:', sourceTrack.languageCode,
    isTranslation ? `(will translate -> ${targetLangCode})` : ''
  );
}
  });
})();
export {};