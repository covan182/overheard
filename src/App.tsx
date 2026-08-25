import { useEffect, useState, useRef } from 'react';
import { getSettings, setSettings, clearWordHistory } from './shared/storage';
import type { OverheardSettings, CaptionStyle, HistoryEntry, PopupTab } from './shared/storage';
import { FONT_FAMILIES, DEFAULT_CAPTION_STYLE, DEFAULT_FONT_SIZE, DEFAULT_OVERLAY_LAYOUT, GOOGLE_FONTS_URL } from './shared/storage';
import { BUILT_IN_PRESETS } from './shared/presets';
import { LANGUAGES } from './shared/languages';
import type { Language } from './shared/languages';
import { KOFI_DONATE_URL } from './shared/donation';
import { GITHUB_REPO_URL, DEVELOPER_HANDLE } from './shared/links';
import './App.css';
import { speakText } from './shared/speech';
import logoUrl from './assets/logo.png';
import soundwaveIcon from './shared/../assets/soundwave.svg';

// Strips accents/diacritics for comparison, so "francais" still matches
// "Français" — cheap addition that meaningfully helps search.
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const LanguagePicker = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selected = LANGUAGES.find((l: Language) => l.code === value);
  const filtered = query
    ? LANGUAGES.filter((l: Language) => {
        const q = normalize(query);
        return normalize(l.name).includes(q) || normalize(l.nativeName).includes(q);
      })
    : LANGUAGES;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="picker" ref={wrapperRef}>
      <label className="picker-label">{label}</label>
      <div className="picker-control" onClick={() => setOpen(true)}>
        <input
          type="text"
          className="picker-input"
          value={open ? query : (selected?.name ?? '')}
          placeholder={selected?.name ?? 'Select language'}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        <span className={`picker-chevron ${open ? 'open' : ''}`}>▾</span>
      </div>
      {open && (
        <div className="picker-dropdown">
          {filtered.length === 0 && <div className="picker-empty">No matches</div>}
          {filtered.map((lang: Language) => (
            <div
              key={lang.code}
              className={`picker-option ${lang.code === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(lang.code);
                setOpen(false);
                setQuery('');
              }}
            >
              {lang.name}
              {lang.nativeName.toLowerCase() !== lang.name.toLowerCase() && (
                <span className="picker-native-name"> — {lang.nativeName}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const timeAgo = (timestamp: number) => {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
};

const App = () => {
  const [settings, setLocalSettings] = useState<OverheardSettings | null>(null);
  const [tab, setTab] = useState<PopupTab>('settings');
  const [addingPreset, setAddingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSettings().then((s) => {
      setLocalSettings(s);
      setTab(s.activeTab);
    });
  }, []);

  useEffect(() => {
    if (document.getElementById('overheard-google-fonts')) return;
    const link = document.createElement('link');
    link.id = 'overheard-google-fonts';
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.wordHistory) {
        setLocalSettings(prev => prev ? { ...prev, wordHistory: changes.wordHistory.newValue as HistoryEntry[] } : prev);
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => chrome.storage.onChanged.removeListener(handleChange);
  }, []);

  const changeTab = (next: PopupTab) => {
    setTab(next);
    setSettings({ activeTab: next });
  };

  const update = (patch: Partial<OverheardSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocalSettings(next);
    setSettings(patch);
  };

  const updateDebounced = (patch: Partial<OverheardSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setLocalSettings(next);

    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSettings(patch);
    }, 150);
  };

  const updateStyle = (patch: Partial<CaptionStyle>) => {
    if (!settings) return;
    updateDebounced({ captionStyle: { ...settings.captionStyle, ...patch } });
  };

  const applyPreset = (style: CaptionStyle) => {
    update({ captionStyle: style });
  };

  const saveCurrentAsPreset = () => {
    if (!settings || !newPresetName.trim()) return;
    const preset = {
      id: `custom-${Date.now()}`,
      name: newPresetName.trim(),
      style: settings.captionStyle,
    };
    update({ customPresets: [...settings.customPresets, preset] });
    setNewPresetName('');
    setAddingPreset(false);
  };

  const deleteCustomPreset = (id: string) => {
    if (!settings) return;
    update({ customPresets: settings.customPresets.filter(p => p.id !== id) });
  };

  const resetPosition = () => {
    update({ overlayLayout: DEFAULT_OVERLAY_LAYOUT });
  };

  const resetAppearance = () => {
    update({ captionStyle: DEFAULT_CAPTION_STYLE, fontSize: DEFAULT_FONT_SIZE, overlayLayout: DEFAULT_OVERLAY_LAYOUT });
  };

  const handleClearHistory = () => {
    clearWordHistory();
    setLocalSettings(prev => prev ? { ...prev, wordHistory: [] } : prev);
  };

  if (!settings) return <div className="app-root loading">Loading…</div>;

  return (
    <div className="app-root">
      <div className="app-header">
        <img src={logoUrl} alt="Overheard" className="app-logo" />
        <div className="header-actions">
          {tab === 'appearance' && (
            <button className="reset-all-btn" onClick={resetAppearance} title="Reset appearance to defaults">↺</button>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => update({ enabled: e.target.checked })}
            />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
          </label>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} data-label="Languages" onClick={() => changeTab('settings')}>
          Languages
        </button>
        <button className={`tab ${tab === 'appearance' ? 'active' : ''}`} data-label="Appearance" onClick={() => changeTab('appearance')}>
          Appearance
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} data-label="History" onClick={() => changeTab('history')}>
          History
        </button>
        <button className={`tab ${tab === 'about' ? 'active' : ''}`} data-label="About" onClick={() => changeTab('about')}>
          About
        </button>
        <button className={`tab ${tab === 'support' ? 'active' : ''}`} data-label="Support Me" onClick={() => changeTab('support')}>
          Support Me
        </button>
      </div>

      {tab === 'settings' && (
        <>
          <LanguagePicker
            label="Primary Subtitle (Top)"
            value={settings.primaryLanguage}
            onChange={code => update({ primaryLanguage: code })}
          />
          <LanguagePicker
            label="Learning Subtitle (Bottom)"
            value={settings.secondaryLanguage}
            onChange={code => update({ secondaryLanguage: code })}
          />
          <div className="app-footer">Changes should apply after a few seconds</div>
        </>
      )}

      {tab === 'appearance' && (
        <>
          <div className="field">
            <label className="picker-label">Presets</label>
            <div className="preset-row">
              {BUILT_IN_PRESETS.map(p => (
                <button key={p.id} className="preset-chip" onClick={() => applyPreset(p.style)}>
                  {p.name}
                </button>
              ))}
              {settings.customPresets.map(p => (
                <span key={p.id} className="preset-chip-wrap">
                  <button className="preset-chip" onClick={() => applyPreset(p.style)}>{p.name}</button>
                  <button className="preset-chip-remove" onClick={() => deleteCustomPreset(p.id)} title="Delete preset">×</button>
                </span>
              ))}
            </div>

            {!addingPreset ? (
              <button className="preset-add-btn" onClick={() => setAddingPreset(true)}>+ Save current as preset</button>
            ) : (
              <div className="preset-add-form">
                <input
                  type="text"
                  className="preset-name-input"
                  placeholder="Preset name"
                  value={newPresetName}
                  onChange={e => setNewPresetName(e.target.value)}
                  autoFocus
                />
                <button className="preset-confirm-btn" onClick={saveCurrentAsPreset} disabled={!newPresetName.trim()}>Save</button>
                <button className="preset-cancel-btn" onClick={() => { setAddingPreset(false); setNewPresetName(''); }}>Cancel</button>
              </div>
            )}
          </div>

          <div className="field">
            <label className="picker-label">Font</label>
            <select
              className="select-control"
              value={settings.captionStyle.fontFamily}
              onChange={e => updateStyle({ fontFamily: e.target.value })}
            >
              {FONT_FAMILIES.map(f => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="picker-label">Subtitle size — {settings.fontSize}px</label>
            <input
              type="range" min={16} max={48}
              value={settings.fontSize}
              onChange={e => updateDebounced({ fontSize: Number(e.target.value) })}
              className="slider"
            />
          </div>

          <div className="field-grid">
            <div className="field">
              <label className="picker-label">Primary color</label>
              <input
                type="color"
                value={settings.captionStyle.primaryColor}
                onChange={e => updateStyle({ primaryColor: e.target.value })}
                className="color-control"
              />
            </div>
            <div className="field">
              <label className="picker-label">Primary outline</label>
              <input
                type="color"
                value={settings.captionStyle.primaryBorderColor}
                onChange={e => updateStyle({ primaryBorderColor: e.target.value })}
                className="color-control"
              />
            </div>
            <div className="field">
              <label className="picker-label">Learning color</label>
              <input
                type="color"
                value={settings.captionStyle.secondaryColor}
                onChange={e => updateStyle({ secondaryColor: e.target.value })}
                className="color-control"
              />
            </div>
            <div className="field">
              <label className="picker-label">Learning outline</label>
              <input
                type="color"
                value={settings.captionStyle.secondaryBorderColor}
                onChange={e => updateStyle({ secondaryBorderColor: e.target.value })}
                className="color-control"
              />
            </div>
          </div>

          <div className="field">
            <label className="picker-label">
              Outline thickness — {settings.captionStyle.borderWidth === 0 ? 'None' : `${settings.captionStyle.borderWidth}px`}
            </label>
            <input
              type="range" min={0} max={4} step={1}
              value={settings.captionStyle.borderWidth}
              onChange={e => updateStyle({ borderWidth: Number(e.target.value) })}
              className="slider"
            />
          </div>

          <div className="field">
            <label className="picker-label">
              Background — {Math.round(settings.captionStyle.backgroundOpacity * 100)}%
            </label>
            <input
              type="range" min={0} max={100}
              value={Math.round(settings.captionStyle.backgroundOpacity * 100)}
              onChange={e => updateStyle({ backgroundOpacity: Number(e.target.value) / 100 })}
              className="slider"
            />
          </div>

          <button className="reset-btn" onClick={resetPosition}>Reset position</button>
          <div className="app-footer">Drag the captions on the video to reposition them.</div>
        </>
      )}

      {tab === 'history' && (
  <div className="history-tab">
    {settings.wordHistory.length === 0 ? (
      <p className="support-text">
        No words looked up yet. Tap a word in the subtitles on YouTube to see its translation here.
      </p>
    ) : (
      <>
        <div className="history-list">
          {settings.wordHistory.map((entry, i) => (
            <div key={i} className="history-item">
              <div className="history-words">
                <span className="history-word">{entry.word}</span>
                <button
                  className="history-speaker-btn"
                  title="Listen (original)"
                  onClick={() => speakText(entry.word, entry.sourceLang)}
                >
                  <img src={soundwaveIcon} alt="Play pronunciation" className="overheard-speaker-icon" />
                </button>
                <span className="history-arrow">→</span>
                <span className="history-translation">{entry.translation}</span>
                <button
                  className="history-speaker-btn"
                  title="Listen (translation)"
                  onClick={() => speakText(entry.translation, entry.targetLang)}
                >
                  <img src={soundwaveIcon} alt="Play pronunciation" className="overheard-speaker-icon" />
                </button>
              </div>
              <span className="history-time">{timeAgo(entry.timestamp)}</span>
            </div>
          ))}
        </div>
        <button className="reset-btn" onClick={handleClearHistory}>Clear history</button>
      </>
    )}
  </div>
)}

      {tab === 'about' && (
        <div className="about-section about-section--tab">
          <h3 className="about-title">About Overheard</h3>
          <p className="about-text">
            Overheard works by requesting YouTube's own captions. It doesn't generate
              translations itself. If a video has no captions at all, subtitles won't
              appear here either. When your chosen language isn't available natively,
              we ask YouTube to auto-translate from whichever caption track the video
              does have, so quality depends on both that original track (manual captions
              are more accurate than auto-generated ones) and YouTube's own translation
              engine.
          </p>
          <p className="about-text">
            Tapping any word in the subtitles looks up a quick translation into the
              other language you've chosen, shown along with its pronunciation as well. It's instant but for nuance or grammar it's worth double-checking with a
              proper dictionary.
          </p>
        </div>
      )}

      {tab === 'support' && (
        <div className="support-tab">
          <p className="support-text">
            Overheard is completely free to use. If it has been helping you learn a language consider making a donation. This will motivate me even more to continue this project.
          </p>
          <button
            className="donate-btn"
            onClick={() => window.open(KOFI_DONATE_URL, '_blank')}
          >
            Support on Ko-fi
          </button>
        </div>
      )}

      <footer className="app-link-footer">
        Developed by{' '}
        <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
          {DEVELOPER_HANDLE}
        </a>
      </footer>
    </div>
  );
};

export default App;