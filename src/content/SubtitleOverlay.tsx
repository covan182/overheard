import React, { useState, useRef, useEffect } from 'react';
import type { CaptionStyle, OverlayLayout } from '../shared/storage';
import { getScriptFontInfo } from '../shared/scriptFonts';
import { speakText } from '../shared/speech';
import soundwaveIcon from '../assets/soundwave.svg';

interface Props {
  primaryText: string;
  secondaryText: string;
  captionStyle: CaptionStyle;
  fontSize: number;
  layout: OverlayLayout;
  onLayoutChange: (layout: OverlayLayout) => void;
  primaryLanguage: string;
  secondaryLanguage: string;
  onWordClick: (word: string, sourceLang: string, targetLang: string) => Promise<string | null>;
  speechVolume: number;
  primaryLoading: boolean;
  secondaryLoading: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const CLICK_THRESHOLD_PX = 6;
const POPOVER_DISMISS_MS = 6000;

const makeOutline = (color: string, width: number) => {
  if (width <= 0) return 'none';
  const offsets = [
    [-width, -width], [0, -width], [width, -width],
    [-width, 0], [width, 0],
    [-width, width], [0, width], [width, width],
  ];
  return offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(', ');
};

const cleanWord = (raw: string) => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const combineFontFamily = (base: string, langCode: string): string => {
  const scriptInfo = getScriptFontInfo(langCode);
  return scriptInfo ? `${base}, ${scriptInfo.fontFamily}` : base;
};

const resolveFontWeight = (defaultWeight: number, langCode: string): number => {
  const scriptInfo = getScriptFontInfo(langCode);
  return scriptInfo ? scriptInfo.fontWeight : defaultWeight;
};

interface Popover {
  word: string;
  sourceLang: string;
  translation: string | null;
  loading: boolean;
  x: number;
  y: number;
  targetLang: string;
}

interface ClickCandidate {
  word: string;
  sourceLang: string;
  targetLang: string;
}

const SubtitleOverlay: React.FC<Props> = ({
  primaryText, secondaryText, captionStyle, fontSize, layout, onLayoutChange,
  primaryLanguage, secondaryLanguage, onWordClick, speechVolume,
  primaryLoading, secondaryLoading,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [pixelPos, setPixelPos] = useState<{ x: number; y: number } | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const clickCandidate = useRef<ClickCandidate | null>(null);

  useEffect(() => {
    const container = document.getElementById('overheard-root');
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      setBounds({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (dragState.current) return;
    if (bounds.width === 0 || bounds.height === 0) return;
    const fx = layout.fx ?? 0.5;
    const fy = layout.fy ?? 0.88;
    setPixelPos({ x: fx * bounds.width, y: fy * bounds.height });
  }, [layout.fx, layout.fy, bounds.width, bounds.height]);

  useEffect(() => {
    setPopover(null);
  }, [primaryText, secondaryText]);

  useEffect(() => {
    if (!popover) return;
    const t = setTimeout(() => setPopover(null), POPOVER_DISMISS_MS);
    return () => clearTimeout(t);
  }, [popover?.word, popover?.loading]);

  const clampToBounds = (x: number, y: number) => {
    const boxW = boxRef.current?.offsetWidth ?? 0;
    const boxH = boxRef.current?.offsetHeight ?? 0;
    const halfW = boxW / 2;
    return {
      x: clamp(x, halfW, Math.max(halfW, bounds.width - halfW)),
      y: clamp(y, boxH, Math.max(boxH, bounds.height)),
    };
  };

  const handleWordActivate = (candidate: ClickCandidate, clientX: number, clientY: number) => {
    const container = document.getElementById('overheard-root');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const px = clientX - containerRect.left;
    const py = clientY - containerRect.top;

    setPopover({
      word: candidate.word,
      sourceLang: candidate.sourceLang,
      translation: null,
      loading: true,
      x: px,
      y: py,
      targetLang: candidate.targetLang,
    });

    onWordClick(candidate.word, candidate.sourceLang, candidate.targetLang).then((translation) => {
      setPopover(prev => (prev && prev.word === candidate.word ? { ...prev, translation, loading: false } : prev));
    });
  };

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = document.getElementById('overheard-root');
    const box = boxRef.current;
    if (!container || !box) return;

    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const realX = (boxRect.left + boxRect.width / 2) - containerRect.left;
    const realY = boxRect.bottom - containerRect.top;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: realX, origY: realY };
    setPixelPos({ x: realX, y: realY });

    const wordEl = (e.target as HTMLElement).closest('[data-word]') as HTMLElement | null;
    clickCandidate.current = wordEl
      ? {
          word: wordEl.dataset.word!,
          sourceLang: wordEl.dataset.sourceLang!,
          targetLang: wordEl.dataset.targetLang!,
        }
      : null;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPixelPos(clampToBounds(dragState.current.origX + dx, dragState.current.origY + dy));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const moved = dragState.current
      ? Math.hypot(e.clientX - dragState.current.startX, e.clientY - dragState.current.startY)
      : Infinity;

    if (dragState.current && pixelPos && bounds.width > 0 && bounds.height > 0) {
      onLayoutChange({ fx: pixelPos.x / bounds.width, fy: pixelPos.y / bounds.height });
    }
    dragState.current = null;

    if (moved < CLICK_THRESHOLD_PX && clickCandidate.current) {
      handleWordActivate(clickCandidate.current, e.clientX, e.clientY);
    }
    clickCandidate.current = null;
  };

  const renderClickableText = (text: string, lineLang: string, targetLang: string) => {
    const tokens = text.split(/(\s+)/);
    return tokens.map((token, i) => {
      if (token.trim() === '') return token;
      const word = cleanWord(token);
      if (!word) return token;
      return (
        <span
          key={i}
          className="overheard-word"
          data-word={word}
          data-source-lang={lineLang}
          data-target-lang={targetLang}
        >
          {token}
        </span>
      );
    });
  };

  if (!primaryText && !secondaryText && !primaryLoading && !secondaryLoading) return null;
  if (!pixelPos) return null;

  return (
    <>
      <style>{`
        .overheard-word { cursor: pointer; }
        .overheard-word:hover { text-decoration: underline; text-underline-offset: 3px; }
        .overheard-speaker-btn { /* unchanged */ }
        .overheard-popover-row { /* unchanged */ }
        @keyframes overheard-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.9; }
        }
        .overheard-loading-dots span {
          display: inline-block;
          width: 5px;
          height: 5px;
          margin: 0 2px;
          border-radius: 50%;
          background: currentColor;
          animation: overheard-pulse 1.2s ease-in-out infinite;
        }
        .overheard-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .overheard-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <div
        ref={boxRef}
        onPointerDown={handleDragStart}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(${pixelPos.x}px, ${pixelPos.y}px) translate(-50%, -100%)`,
          pointerEvents: 'auto',
          cursor: dragState.current ? 'grabbing' : 'grab',
          maxWidth: '90%',
          padding: '0.3em 0.6em',
          background: `rgba(0, 0, 0, ${captionStyle.backgroundOpacity})`,
          borderRadius: '6px',
          textAlign: 'center',
          userSelect: 'none',
          touchAction: 'none',
          fontFamily: captionStyle.fontFamily,
          fontSize: `${fontSize}px`,
        }}
      >
        {primaryText ? (
          <div style={{
            color: captionStyle.primaryColor,
            fontSize: '1em',
            fontWeight: resolveFontWeight(700, primaryLanguage),
            fontFamily: combineFontFamily(captionStyle.fontFamily, primaryLanguage),
            lineHeight: 1.3,
            textShadow: makeOutline(captionStyle.primaryBorderColor, captionStyle.borderWidth),
          }}>
            {renderClickableText(primaryText, primaryLanguage, secondaryLanguage)}
          </div>
        ) : primaryLoading ? (
          <div className="overheard-loading-dots" style={{ color: captionStyle.primaryColor, textAlign: 'center' }}>
            <span></span><span></span><span></span>
          </div>
        ) : null}
        {secondaryText ? (
          <div style={{
            color: captionStyle.secondaryColor,
            fontSize: '0.7em',
            fontWeight: resolveFontWeight(600, secondaryLanguage),
            fontFamily: combineFontFamily(captionStyle.fontFamily, secondaryLanguage),
            lineHeight: 1.3,
            marginTop: '0.1em',
            textShadow: makeOutline(captionStyle.secondaryBorderColor, captionStyle.borderWidth),
          }}>
            {renderClickableText(secondaryText, secondaryLanguage, primaryLanguage)}
          </div>
        ) : secondaryLoading ? (
          <div className="overheard-loading-dots" style={{ color: captionStyle.secondaryColor, textAlign: 'center', marginTop: '0.1em' }}>
            <span></span><span></span><span></span>
          </div>
        ) : null}
      </div>

      {popover && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${popover.x}px, ${popover.y}px) translate(-50%, calc(-100% - 10px))`,
            background: 'rgba(20,20,20,0.95)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px',
            padding: '10px 16px',
            fontFamily: captionStyle.fontFamily,
            color: '#fff',
            maxWidth: '320px',
            zIndex: 10,
            boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
          }}
        >
          {popover.loading ? (
            <span style={{ fontSize: '18px' }}>…</span>
          ) : (
            <>
              {/* Original word — smaller, muted, on top, Google Translate-style */}
              <div
                className="overheard-popover-row"
                style={{
                  fontSize: '13px',
                  color: '#aaa',
                  fontWeight: resolveFontWeight(500, popover.sourceLang),
                  fontFamily: combineFontFamily(captionStyle.fontFamily, popover.sourceLang),
                }}
              >
                <span>{popover.word}</span>
                <button
                  className="overheard-speaker-btn"
                  title="Listen (original)"
                  onClick={() => speakText(popover.word, popover.sourceLang, speechVolume)}
                >
                  <img
                    src={soundwaveIcon}
                    alt="Play pronunciation"
                    style={{ width: 20, height: 20, verticalAlign: 'middle', filter: 'brightness(0) invert(1)', opacity: 0.85, cursor: 'pointer' }}
                  />
                </button>
              </div>

              {/* Translation — larger, bold, below */}
              <div
                className="overheard-popover-row"
                style={{
                  fontSize: '18px',
                  fontWeight: resolveFontWeight(600, popover.targetLang),
                  fontFamily: combineFontFamily(captionStyle.fontFamily, popover.targetLang),
                  marginTop: '2px',
                }}
              >
                <span>{popover.translation ?? 'No translation found'}</span>
                {popover.translation && (
                  <button
                    className="overheard-speaker-btn"
                    title="Listen (translation)"
                    onClick={() => speakText(popover.translation!, popover.targetLang, speechVolume)}
                  >
                    <img
                      src={soundwaveIcon}
                      alt="Play pronunciation"
                      style={{ width: 20, height: 20, verticalAlign: 'middle', filter: 'brightness(0) invert(1)', opacity: 0.85, cursor: 'pointer' }}
                    />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default SubtitleOverlay;