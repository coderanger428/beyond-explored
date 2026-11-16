import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import { SocialIcon } from '../../components/SocialIcon';
import { useDashboard } from '../../app/DashboardContext';
import { recognizeProvider, socialProviderLabel } from '../../lib/social';
import { cls } from '../../styles/cls';
import modal from '../../styles/modal.module.css';
import pool from '../../styles/pool.module.css';
import ui from '../../styles/ui.module.css';

const locationEffectLabel = (action) => (action === 'delete' ? 'Excluded' : '');

let linkDraftSeq = 1;
const nextLinkId = () => linkDraftSeq++;

const providerOf = (url) => {
  const text = String(url || '').trim();
  if (!text) return 'generic';
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return recognizeProvider('', withScheme);
};

const sourceOrigin = (user) =>
  String(user?.source || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .find(Boolean) || '';

function LocationField({ value, onChange, onCommit, disabled = false }) {
  const inputRef = useRef(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(0);
  const [menuPos, setMenuPos] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const queryText = value.trim();
    if (queryText.length < 2) {
      setSuggestions([]);
      setActive(0);
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const handle = window.setTimeout(() => {
      fetch(`/api/locations/suggest?q=${encodeURIComponent(queryText)}`)
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data) => {
          if (requestId !== requestRef.current) return;
          const next = Array.isArray(data.suggestions) ? data.suggestions : [];
          setSuggestions(next);
          setActive(0);
        })
        .catch(() => {
          if (requestId !== requestRef.current) return;
          setSuggestions([]);
        });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [value, open]);

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return undefined;
    const place = () => {
      const rect = inputRef.current.getBoundingClientRect();
      setMenuPos({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(rect.width, 240),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, value, suggestions]);

  const pick = (index) => {
    const item = suggestions[index];
    setOpen(false);
    if (item) {
      onChange(item.location);
      onCommit(item.location);
    }
  };

  return (
    <label>
      Location
      <input
        ref={inputRef}
        type="text"
        value={value}
        maxLength={300}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder="City, country"
        aria-autocomplete="list"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
          onCommit(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp' && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (open && suggestions.length) pick(active);
            else onCommit(value);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && menuPos && suggestions.length ? (
        <div
          className={cls(pool, 'location-suggest-menu')}
          role="listbox"
          style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width, zIndex: 1100 }}
        >
          {suggestions.map((item, index) => {
            const effect = locationEffectLabel(item.action);
            return (
              <button
                key={`${item.location}-${item.country}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={cls(pool, index === active
                  ? 'location-suggest-option active'
                  : 'location-suggest-option')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                <span>{item.location}</span>
                {effect ? (
                  <span className={cls(pool, 'location-suggest-meta is-delete')}>{effect}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </label>
  );
}

function UserDetailForm({
  user,
  onClose,
  onSaveName,
  onSaveEmail,
  onSaveLocation,
  onSaveGithub,
  onAddLink,
  onReplaceLink,
  onRemoveLink,
}) {
  const busyRef = useRef(false);
  const nameLocked = String(user.mail_status || '').toLowerCase() === 'sent';
  const githubRequired = sourceOrigin(user) === 'github';
  const [savedName, setSavedName] = useState(String(user.display_name || user.name || ''));
  const [savedEmail, setSavedEmail] = useState(String(user.email || ''));
  const [savedLocation, setSavedLocation] = useState(String(user.location || ''));
  const [savedGithub, setSavedGithub] = useState(String(user.github || ''));
  const [displayName, setDisplayName] = useState(savedName);
  const [email, setEmail] = useState(savedEmail);
  const [location, setLocation] = useState(savedLocation);
  const [github, setGithub] = useState(savedGithub);
  const [links, setLinks] = useState(() =>
    (Array.isArray(user.socials) ? user.socials : [])
      .map((item) => {
        const url = String(item?.url || '').trim();
        return url ? { id: nextLinkId(), url, savedUrl: url } : null;
      })
      .filter(Boolean)
  );
  const [draftLink, setDraftLink] = useState('');
  const [busy, setBusy] = useState('');

  const run = async (key, task) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(key);
    try {
      return await task();
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };

  const commitName = () => {
    if (nameLocked) return;
    const next = displayName.trim();
    const effective = next || String(user.name || '');
    if (effective === savedName) return;
    run('name', () => onSaveName(next).then((saved) => {
      if (!saved) return;
      const value = String(saved.display_name || effective);
      setDisplayName(value);
      setSavedName(value);
    }));
  };

  const commitEmail = () => {
    const next = email.trim();
    if (!next) {
      setEmail(savedEmail);
      return;
    }
    if (next === savedEmail) return;
    run('email', () => onSaveEmail(next).then((saved) => {
      if (!saved) return;
      const value = String(saved.email || next);
      setEmail(value);
      setSavedEmail(value);
    }));
  };

  const commitLocation = (value) => {
    const next = String(value ?? '').trim();
    if (next === savedLocation) return;
    run('location', () => onSaveLocation(next).then((data) => {
      if (!data || data.action === 'delete') {
        if (data?.action === 'delete') onClose();
        return;
      }
      const place = String(data.location ?? next);
      setLocation(place);
      setSavedLocation(place);
    }).catch((err) => {
      if (err?.name === 'AbortError') setLocation(savedLocation);
    }));
  };

  const commitGithub = () => {
    const next = github.trim();
    if (githubRequired && !next) {
      setGithub(savedGithub);
      return;
    }
    if (next === savedGithub) return;
    run('github', () => onSaveGithub(next).then((saved) => {
      if (!saved) return;
      const value = String(saved.github || '');
      setGithub(value);
      setSavedGithub(value);
    }));
  };

  const applySocials = (socials) => {
    const rows = Array.isArray(socials) ? socials : [];
    setLinks(rows.map((item) => {
      const url = String(item?.url || '').trim();
      return { id: nextLinkId(), url, savedUrl: url };
    }).filter((item) => item.url));
  };

  const commitDraftLink = () => {
    const next = draftLink.trim();
    if (!next) return;
    run('draft', () => onAddLink(next).then((saved) => {
      if (!saved) return;
      applySocials(saved.socials);
      setDraftLink('');
    }));
  };

  const commitLink = (item) => {
    const next = item.url.trim();
    if (!next) {
      setLinks((current) => current.map((row) => (
        row.id === item.id ? { ...row, url: row.savedUrl } : row
      )));
      return;
    }
    if (next === item.savedUrl) return;
    run(`link-${item.id}`, () => onReplaceLink(item.savedUrl, next).then((saved) => {
      if (saved) applySocials(saved.socials);
    }));
  };

  const removeLink = (item) => {
    run(`remove-${item.id}`, () => onRemoveLink(item.savedUrl).then((saved) => {
      if (saved) applySocials(saved.socials);
    }));
  };

  const onEnter = (event, commit) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  };

  return (
    <Modal
      isOpen
      onRequestClose={onClose}
      className={`${cls(modal, 'mail-modal')} ${cls(modal, 'user-detail-modal')}`}
      overlayClassName={cls(modal, 'mail-modal-overlay')}
      contentLabel="Edit user"
    >
      <form onSubmit={(event) => event.preventDefault()}>
        <div className={cls(modal, 'mail-modal-header')}>
          <h3>Edit user</h3>
        </div>
        <label>
          Name
          <input
            type="text"
            value={displayName}
            maxLength={200}
            disabled={nameLocked || Boolean(busy)}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => onEnter(event, commitName)}
          />
        </label>
        {nameLocked ? (
          <p className={cls(modal, 'detail-note')}>This name stays because the email was already sent.</p>
        ) : null}
        <label>
          Email
          <input
            type="email"
            value={email}
            maxLength={320}
            disabled={Boolean(busy)}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={commitEmail}
            onKeyDown={(event) => onEnter(event, commitEmail)}
          />
        </label>
        <LocationField
          value={location}
          disabled={Boolean(busy)}
          onChange={setLocation}
          onCommit={commitLocation}
        />
        <label>
          GitHub
          <input
            type="text"
            value={github}
            maxLength={300}
            disabled={Boolean(busy)}
            autoComplete="off"
            spellCheck={false}
            placeholder="username"
            onChange={(event) => setGithub(event.target.value)}
            onBlur={commitGithub}
            onKeyDown={(event) => onEnter(event, commitGithub)}
          />
        </label>
        {githubRequired && !github.trim() ? (
          <p className={cls(modal, 'detail-note')}>This person came from GitHub, so the username stays.</p>
        ) : null}
        <div className={cls(modal, 'detail-socials')}>
          <div className={cls(modal, 'detail-socials-label')}>Social links</div>
          {links.map((item) => {
            const provider = providerOf(item.url);
            return (
              <div key={item.id} className={cls(modal, 'detail-social-row')}>
                <SocialIcon provider={provider} />
                <input
                  type="text"
                  value={item.url}
                  maxLength={500}
                  disabled={Boolean(busy)}
                  placeholder="https://"
                  aria-label={socialProviderLabel(provider)}
                  onChange={(event) => setLinks((current) => current.map((row) => (
                    row.id === item.id ? { ...row, url: event.target.value } : row
                  )))}
                  onKeyDown={(event) => onEnter(event, () => commitLink(item))}
                />
                <button
                  type="button"
                  className={cls(ui, 'secondary-button')}
                  disabled={Boolean(busy)}
                  onClick={() => removeLink(item)}
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div className={`${cls(modal, 'detail-social-row')} ${cls(modal, 'detail-social-draft')}`}>
            <SocialIcon provider={providerOf(draftLink)} />
            <input
              type="text"
              value={draftLink}
              maxLength={500}
              disabled={Boolean(busy)}
              placeholder="https://"
              aria-label="New social link"
              onChange={(event) => setDraftLink(event.target.value)}
              onKeyDown={(event) => onEnter(event, commitDraftLink)}
            />
          </div>
        </div>
        <div className={cls(ui, 'form-actions-row form-actions-end')}>
          <button type="button" className={cls(ui, 'secondary-button')} onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UserDetailModal() {
  const {
    detailUser,
    closeUserDetail,
    saveDetailName,
    saveDetailEmail,
    saveDetailLocation,
    saveDetailGithub,
    saveDetailLink,
    replaceDetailLink,
    removeDetailLink,
  } = useDashboard();
  if (!detailUser) return null;
  return (
    <UserDetailForm
      key={detailUser.id}
      user={detailUser}
      onClose={closeUserDetail}
      onSaveName={(value) => saveDetailName(detailUser, value)}
      onSaveEmail={(value) => saveDetailEmail(detailUser, value)}
      onSaveLocation={(value) => saveDetailLocation(detailUser, value)}
      onSaveGithub={(value) => saveDetailGithub(detailUser, value)}
      onAddLink={(url) => saveDetailLink(detailUser, url)}
      onReplaceLink={(previous, url) => replaceDetailLink(detailUser, previous, url)}
      onRemoveLink={(url) => removeDetailLink(detailUser, url)}
    />
  );
}
