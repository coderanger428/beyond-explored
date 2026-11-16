import { useEffect, useState } from 'react';
import Modal from 'react-modal';
import toast from 'react-hot-toast';
import { IconRefresh } from '../../components/Icons';
import { cls } from '../../styles/cls';
import ui from '../../styles/ui.module.css';
import modal from '../../styles/modal.module.css';
import settings from '../../styles/settings.module.css';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_TARGETS = {
  lookup: {
    path: '/api/github-token',
    check: '/api/github-token/check',
    saved: 'GitHub token replaced.',
    note: 'Used when a dev.to profile points at a GitHub account.',
  },
  scrape: {
    path: '/api/github-scrape-token',
    check: '/api/github-scrape-token/check',
    saved: 'GitHub token replaced.',
    note: 'Lists a page of usernames, then looks up each profile. The dev.to scraper keeps its own token.',
  },
};

function tokyoExpiration(iso) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')} JST`;
}

function expiresWithinWeek(iso) {
  if (!iso) {
    return false;
  }
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  const remaining = time - Date.now();
  return remaining > 0 && remaining < WEEK_MS;
}

function TokenExpiry({ info }) {
  if (!info) {
    return null;
  }
  if (info.status === 'expired' || info.expired) {
    return <span className={cls(settings, 'token-expired')}>Expired</span>;
  }
  if (info.status === 'invalid') {
    return <span className={cls(settings, 'token-invalid')}>Invalid</span>;
  }
  if (info.status === 'no_expiration') {
    return <span>Does not expire</span>;
  }
  const when = tokyoExpiration(info.expires_at) || info.expires_label;
  const soon = Boolean(info.expires_soon) || (info.status === 'ok' && expiresWithinWeek(info.expires_at));
  if (!when && info.status === 'unreachable') {
    return <span>Could not check expiration</span>;
  }
  return (
    <>
      {when ? (
        <time dateTime={info.expires_at} title="Tokyo time (UTC+9)">
          {when}
        </time>
      ) : null}
      {soon ? <span className={cls(settings, 'token-soon')}>Expired soon</span> : null}
      {info.status === 'unreachable' ? <span>Could not check expiration</span> : null}
    </>
  );
}

export function ScraperToken({ kind }) {
  const target = TOKEN_TARGETS[kind] || TOKEN_TARGETS.lookup;
  const [info, setInfo] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    const load = () => {
      fetch(target.path)
        .then(async (res) => {
          if (res.status === 404) {
            return { missing: true };
          }
          if (!res.ok) {
            return null;
          }
          return res.json();
        })
        .then((data) => {
          if (stop || !data) {
            return;
          }
          if (data.missing) {
            setReady(false);
            return;
          }
          setReady(true);
          setInfo(data);
        })
        .catch(() => {
          if (!stop) {
            setReady(false);
          }
        });
    };
    load();
    const id = window.setInterval(load, 5000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [target.path]);

  const close = () => {
    if (saving) {
      return;
    }
    setOpen(false);
    setDraft('');
    setError('');
  };

  const save = () => {
    const token = draft.trim();
    if (!token || saving) {
      return;
    }
    setSaving(true);
    setError('');
    fetch(target.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = body.detail;
          const message = Array.isArray(detail)
            ? detail.map((item) => item.msg).filter(Boolean).join(' ')
            : detail || `HTTP ${res.status}`;
          throw new Error(message);
        }
        return body;
      })
      .then((data) => {
        setInfo(data);
        setDraft('');
        setReady(true);
        setOpen(false);
        setError('');
        toast.success(target.saved);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setSaving(false));
  };

  const check = () => {
    if (saving) {
      return;
    }
    setSaving(true);
    fetch(target.check, { method: 'POST' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.detail || `HTTP ${res.status}`);
        }
        return body;
      })
      .then(setInfo)
      .catch((err) => {
        toast.error(`Unable to check GitHub token: ${err.message}`);
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className={cls(ui, 'section-block')}>
      <div className={cls(ui, 'section-header')}>
        <h3>GitHub token</h3>
      </div>
      {ready === false && (
        <div className={cls(ui, 'alert')}>
          This dashboard process does not serve token settings yet. They appear after the next restart.
        </div>
      )}
      <div className={cls(settings, 'token-line')}>
        <span>Current token:</span>
        {info?.configured ? (
          <>
            <span className={cls(settings, 'token-mask')}>{info.masked}</span>
            <TokenExpiry info={info} />
            <button
              type="button"
              className={cls(settings, 'token-refresh')}
              aria-label="Refresh expiration"
              title="Refresh expiration"
              onClick={check}
              disabled={ready === false || saving}
            >
              <IconRefresh />
            </button>
          </>
        ) : (
          <span>No token saved</span>
        )}
        <button
          type="button"
          className={cls(settings, 'token-renew')}
          onClick={() => {
            setError('');
            setDraft('');
            setOpen(true);
          }}
          disabled={ready === false || saving}
        >
          Renew token
        </button>
      </div>
      <p>{target.note}</p>
      <Modal
        isOpen={open}
        onRequestClose={close}
        contentLabel="Renew token"
        className={cls(modal, 'mail-modal token-modal')}
        overlayClassName={cls(modal, 'mail-modal-overlay')}
      >
        <div className={cls(modal, 'mail-modal-header')}>
          <h3>Renew token</h3>
        </div>
        <label>
          New token
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste a GitHub token"
            disabled={saving}
          />
        </label>
        {error && <div className={cls(ui, 'alert')}>{error}</div>}
        <div className={cls(ui, 'form-actions-row form-actions-end')}>
          <button type="button" onClick={save} disabled={saving || !draft.trim()}>
            Replace
          </button>
          <button
            type="button"
            className={cls(ui, 'secondary-button')}
            onClick={close}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
