import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { POLL_INTERVAL_MS } from '../lib/constants';
import { maskEmail, formatCountryName, formatGroupMatchHint } from '../lib/format';
import { SCRAPERS } from '../lib/source';
import { SOCIAL_ACCOUNT_FILTERS, emptySocialFilters, socialProviderLabel } from '../lib/social';
import { renderTemplateText, senderDisplayName } from '../lib/templateText';

const LAST_SENDER_KEY = 'last-sender-email';

function readLastSender() {
  try {
    return String(localStorage.getItem(LAST_SENDER_KEY) || '').trim();
  } catch {
    return '';
  }
}

function rememberSender(email) {
  const value = String(email || '').trim();
  if (!value) return '';
  try {
    localStorage.setItem(LAST_SENDER_KEY, value);
  } catch {
    // The choice still lasts until this page is closed.
  }
  return value;
}

function chooseSender(senders, preferred, fallback) {
  const list = Array.isArray(senders) ? senders : [];
  const wanted = String(preferred || '').trim().toLowerCase();
  const match = list.find((email) => String(email || '').trim().toLowerCase() === wanted);
  if (match) return match;
  const next = String(fallback || '').trim();
  if (next && list.some((email) => String(email || '').trim().toLowerCase() === next.toLowerCase())) {
    return list.find((email) => String(email || '').trim().toLowerCase() === next.toLowerCase());
  }
  return list[0] || '';
}

function searchText(value) {
  const text = String(value || '').trim();
  if (text.startsWith('@')) {
    return text.replace(/^@+/, '').trim();
  }
  return text;
}

export function useDashboardState() {
  const [view, setView] = useState('pool');
  const [contactModal, setContactModal] = useState(null);
  const [detailUser, setDetailUser] = useState(null);
  const [countries, setCountries] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [query, setQuery] = useState('');
  const [socialFilters, setSocialFilters] = useState(emptySocialFilters);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mailPreviewSeq = useRef(0);
  const usersRequestSeq = useRef(0);
  const usersAbortRef = useRef(null);
  const lastSenderRef = useRef(readLastSender());
  const [mailAccounts, setMailAccounts] = useState(null);
  const [mailEmail, setMailEmail] = useState('');
  const [mailSenderName, setMailSenderName] = useState('');
  const [mailSaveMode, setMailSaveMode] = useState('create');
  const [mailModalOpen, setMailModalOpen] = useState(false);
  const [scraperInfo, setScraperInfo] = useState(null);
  const [selectedScraper, setSelectedScraper] = useState(SCRAPERS[0].id);
  const [capEnabled, setCapEnabled] = useState(true);
  const [capInput, setCapInput] = useState('');
  const [capDirty, setCapDirty] = useState(false);
  const [displayNameDrafts, setDisplayNameDrafts] = useState({});
  const [savingDisplayNameIds, setSavingDisplayNameIds] = useState(() => new Set());
  const [editingDisplayNameId, setEditingDisplayNameId] = useState(null);
  const [savingOutcomeIds, setSavingOutcomeIds] = useState(() => new Set());
  const [savingFavoriteIds, setSavingFavoriteIds] = useState(() => new Set());
  const [suppressingIds, setSuppressingIds] = useState(() => new Set());
  const [templates, setTemplates] = useState([]);
  const [templateCatalog, setTemplateCatalog] = useState({
    groups: [],
    countries: [],
    custom: [],
  });
  const [selectedTemplateRegion, setSelectedTemplateRegion] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState(null);
  const confirmResolveRef = useRef(null);
  const [templateSaveMode, setTemplateSaveMode] = useState('create');
  const [templateFilename, setTemplateFilename] = useState('');
  const [templateRegion, setTemplateRegion] = useState('etc');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');

  const loadMailAccounts = () => {
    fetch('/api/mail-accounts')
      .then((res) => res.json())
      .then(setMailAccounts)
      .catch((err) => setError(`Unable to load mail accounts: ${err.message}`));
  };

  const applyScraperInfo = (data) => {
    setScraperInfo(data);
    if (!capDirty && data?.platform !== 'github') {
      const enabled = typeof data?.cap_enabled === 'boolean' ? data.cap_enabled : true;
      const cap =
        data?.daily_cap ??
        data?.daily_limit_override ??
        data?.auto_daily_limit ??
        data?.daily_limit ??
        '';
      setCapEnabled(enabled);
      setCapInput(String(cap));
    }
  };

  const loadScraperInfo = () => {
    const platform = selectedScraper === 'github' ? '?platform=github' : '';
    fetch(`/api/scraper${platform}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      })
      .then(applyScraperInfo)
      .catch((err) => setError(`Unable to load scraper: ${err.message}`));
  };

  const loadTemplates = () => {
    Promise.all([
      fetch('/api/templates').then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      }),
      fetch('/api/template-regions').then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      }),
    ])
      .then(([templateData, catalog]) => {
        setTemplates(templateData.templates || []);
        setTemplateCatalog({
          groups: catalog.groups || [],
          countries: catalog.countries || [],
          custom: catalog.custom || [],
        });
      })
      .catch((err) => setError(`Unable to load templates: ${err.message}`));
  };

  const loadCountries = () => {
    fetch('/api/countries')
      .then((res) => res.json())
      .then(setCountries)
      .catch((err) => setError(`Unable to load countries: ${err.message}`));
  };

  useEffect(() => {
    loadCountries();
  }, []);

  const selectedSocials =
    view === 'pool' || view === 'favorites'
      ? SOCIAL_ACCOUNT_FILTERS.map((item) => item.id).filter((id) => socialFilters[id])
      : [];

  const fetchUsers = ({ silent = false } = {}) => {
    const requestId = usersRequestSeq.current + 1;
    usersRequestSeq.current = requestId;
    if (usersAbortRef.current) {
      usersAbortRef.current.abort();
    }
    const controller = new AbortController();
    usersAbortRef.current = controller;
    const q = searchText(query);
    const params = new URLSearchParams();
    if (selectedCountry) {
      params.set('country', selectedCountry);
    }
    if (q) {
      params.set('q', q);
    }
    for (const provider of selectedSocials) {
      params.append('has_social', provider);
    }
    if (view === 'favorites') {
      params.set('favorite', '1');
    }
    params.set('page', page);
    params.set('page_size', pageSize);

    if (!silent) {
      setLoading(true);
      setError('');
    }
    const current = () => requestId === usersRequestSeq.current;
    return fetch(`/api/users?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!current()) return;
        setUsers(data.users || []);
        setTotal(data.total || 0);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || !current()) return;
        if (!silent) {
          setError(`Unable to load users: ${err.message}`);
        }
      })
      .finally(() => {
        if (!current()) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchUsers();
  }, [view, selectedCountry, query, page, pageSize, socialFilters]);

  useEffect(() => {
    if (view === 'senders') {
      loadMailAccounts();
    }
    if (view === 'scraper') {
      loadScraperInfo();
    }
    if (view === 'templates') {
      loadTemplates();
    }
  }, [view, selectedScraper]);

  useEffect(() => {
    const poll = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (view === 'senders') {
        loadMailAccounts();
      }
      if (view === 'pool' || view === 'favorites' || view === 'tracked') {
        loadCountries();
        fetchUsers({ silent: true });
      }
      if (view === 'scraper') {
        loadScraperInfo();
      }
      if (view === 'templates') {
        loadTemplates();
      }
    };

    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) {
        poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [view, selectedCountry, query, page, pageSize, capDirty, socialFilters, selectedScraper]);

  const searchQuery = searchText(query);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const mailAccountsData = mailAccounts || {};
  const accounts = mailAccountsData.accounts || [];
  const byCount = (a, b) =>
    (b.count || 0) - (a.count || 0) || String(a.country).localeCompare(String(b.country));
  const pinNoloc = (items) => {
    const top = items.filter((item) => item.country === 'noloc');
    const rest = items.filter((item) => item.country !== 'noloc');
    return [...top, ...rest];
  };
  const sortedCountries = pinNoloc([...countries].sort(byCount));
  const sidebarCountries =
    view === 'tracked'
      ? pinNoloc(
          sortedCountries
            .filter((item) => (Number(item.sent) || 0) > 0)
            .sort(
              (a, b) =>
                (Number(b.sent) || 0) - (Number(a.sent) || 0) ||
                String(a.country).localeCompare(String(b.country))
            )
        )
      : view === 'favorites'
        ? pinNoloc(
            sortedCountries
              .filter((item) => (Number(item.favorites) || 0) > 0)
              .sort(
                (a, b) =>
                  (Number(b.favorites) || 0) - (Number(a.favorites) || 0) ||
                  String(a.country).localeCompare(String(b.country))
              )
          )
        : sortedCountries;
  const sidebarTotal = sidebarCountries.reduce(
    (sum, item) =>
      sum +
      (view === 'tracked'
        ? Number(item.sent) || 0
        : view === 'favorites'
          ? Number(item.favorites) || 0
          : Number(item.count) || 0),
    0
  );
  const selectedCountryMeta = sortedCountries.find(
    (item) => item.country === selectedCountry
  );
  const trimmedMailEmail = mailEmail.trim().toLowerCase();
  const isEditMode = mailSaveMode === 'update';
  const canSaveMailAccount =
    !!trimmedMailEmail && !!mailSenderName.trim() && !loading;
  const templateGroups = templateCatalog.groups || [];
  const templateCountries = templateCatalog.countries || [];
  const templateCustom = templateCatalog.custom || [];
  const selectedGroupMeta = templateGroups.find(
    (item) => item.slug === selectedTemplateRegion
  );
  const selectedMatchHint = formatGroupMatchHint(selectedGroupMeta);
  const editingGroupMeta = templateGroups.find((item) => item.slug === templateRegion);
  const editingMatchHint = formatGroupMatchHint(editingGroupMeta);
  const visibleTemplates = selectedTemplateRegion
    ? templates.filter((item) => item.region === selectedTemplateRegion)
    : templates;
  const canSaveTemplate =
    !!templateRegion &&
    !!templateSubject.trim() &&
    !!templateBody.trim() &&
    !loading;
  const templateSidebarCountries = templateCountries.filter(
    (item) => (item.templates || 0) > 0
  );
  const templateSidebarCustom = templateCustom.filter(
    (item) => (item.templates || 0) > 0
  );

  const handleResetMailForm = () => {
    setMailEmail('');
    setMailSenderName('');
    setMailSaveMode('create');
  };

  const openCreateMailModal = () => {
    handleResetMailForm();
    setMailSaveMode('create');
    setMailModalOpen(true);
  };

  const openEditMailModal = (account) => {
    setMailEmail(account.email || '');
    setMailSenderName(account.sender_name || '');
    setMailSaveMode('update');
    setMailModalOpen(true);
  };

  const closeMailModal = () => {
    setMailModalOpen(false);
    handleResetMailForm();
  };

  const handleAddMailAccount = () => {
    setLoading(true);
    setError('');

    const url = isEditMode
      ? `/api/mail-accounts/${encodeURIComponent(trimmedMailEmail)}`
      : '/api/mail-accounts';
    const method = isEditMode ? 'PUT' : 'POST';
    const payload = { sender_name: mailSenderName.trim() };
    if (!isEditMode) {
      payload.email = mailEmail.trim();
    }

    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            throw new Error(body.detail || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then(() => {
        toast.success(isEditMode ? 'Mail account updated.' : 'Mail account added.');
        closeMailModal();
        loadMailAccounts();
      })
      .catch((err) => {
        const message = `Unable to save mail account: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  const handleDeleteMailAccount = () => {
    if (!isEditMode || !trimmedMailEmail) {
      toast.error('Select an existing account first.');
      return;
    }
    setLoading(true);
    setError('');

    fetch(`/api/mail-accounts/${encodeURIComponent(trimmedMailEmail)}`, {
      method: 'DELETE',
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            throw new Error(body.detail || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then(() => {
        toast.success(`Deleted ${maskEmail(trimmedMailEmail)}.`);
        closeMailModal();
        loadMailAccounts();
      })
      .catch((err) => {
        const message = `Unable to delete mail account: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  const displayNameValue = (user) => {
    if (Object.prototype.hasOwnProperty.call(displayNameDrafts, user.id)) {
      return displayNameDrafts[user.id];
    }
    return user.display_name ?? user.name ?? '';
  };

  const handleDisplayNameChange = (userId, value) => {
    setDisplayNameDrafts((current) => ({ ...current, [userId]: value }));
  };

  const handleCancelDisplayName = (userId) => {
    setDisplayNameDrafts((current) => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
  };

  const handleSaveDisplayName = (user) => {
    if (!Object.prototype.hasOwnProperty.call(displayNameDrafts, user.id)) {
      return;
    }
    if (savingDisplayNameIds.has(user.id)) {
      return;
    }
    const next = String(displayNameDrafts[user.id] ?? '').trim();
    const current = String(user.display_name ?? user.name ?? '').trim();
    if (next === current) {
      handleCancelDisplayName(user.id);
      return;
    }

    setSavingDisplayNameIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(user.id);
      return nextIds;
    });
    setError('');
    fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: next }),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            throw new Error(body.detail || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => {
        const saved = data.user || {};
        setUsers((list) =>
          list.map((row) => (row.id === user.id ? { ...row, ...saved } : row))
        );
        handleCancelDisplayName(user.id);
      })
      .catch((err) => {
        const message = `Unable to save display name: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setSavingDisplayNameIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(user.id);
          return nextIds;
        });
      });
  };

  const askConfirm = (prompt) =>
    new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmPrompt(prompt);
    });

  const closeConfirm = (accepted) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmPrompt(null);
    if (resolve) resolve(Boolean(accepted));
  };

  const handleSaveLocation = (user, next) => {
    const name = String(user.display_name || user.name || user.email || 'this user').trim();
    const text = String(next ?? '').trim();
    setError('');
    const preview = text
      ? fetch(`/api/locations/decide?q=${encodeURIComponent(text)}`).then(async (res) => {
          if (!res.ok) return null;
          return res.json();
        }).catch(() => null)
      : Promise.resolve(null);
    return preview.then(async (decision) => {
      if (decision?.action === 'delete') {
        const countryName = formatCountryName(decision.country) || 'This country';
        const accepted = await askConfirm({
          title: `Exclude ${countryName}?`,
          message: `${decision.location} is an excluded country. Saving it deletes ${name}.`,
          confirmLabel: 'Exclude',
        });
        if (!accepted) {
          const cancelled = new Error('cancelled');
          cancelled.name = 'AbortError';
          throw cancelled;
        }
      }
      return fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: next }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = body.detail;
          const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`;
          throw new Error(message);
        }
        return body;
      })
      .then((data) => {
        const action = data.action || 'save';
        const place = data.location || next || 'this place';
        if (action === 'delete') {
          toast.success(`Deleted ${name}. ${place} is excluded.`);
          loadCountries();
          fetchUsers({ silent: true });
          return data;
        }
        const saved = data.user || {};
        const leftCountry =
          selectedCountry && saved.country && saved.country !== selectedCountry;
        if (leftCountry) {
          loadCountries();
          fetchUsers({ silent: true });
          return data;
        }
        setUsers((list) =>
          list.map((row) => (row.id === user.id ? { ...row, ...saved } : row))
        );
        if (saved.country && saved.country !== user.country) {
          loadCountries();
        }
        return data;
      })
      .catch((err) => {
        if (err?.name === 'AbortError') throw err;
        const message = `Unable to save location: ${err.message}`;
        setError(message);
        toast.error(message);
        throw err;
      });
    });
  };

  const openUserDetail = (user) => {
    setDetailUser(user);
  };

  const closeUserDetail = () => {
    setDetailUser(null);
  };

  const rememberDetailUser = (saved) => {
    if (!saved || saved.id == null) return;
    setUsers((list) => list.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)));
    setDetailUser((current) => (current && current.id === saved.id ? { ...current, ...saved } : current));
    handleCancelDisplayName(saved.id);
  };

  const saveDetailRequest = (user, url, method, body, label) => fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (res) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = payload.detail;
      throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
    }
    return payload.user || null;
  }).then((saved) => {
    if (saved) rememberDetailUser(saved);
    toast.success(label);
    return saved;
  }).catch((err) => {
    toast.error(err.message || 'Unable to save.');
    return null;
  });

  const saveDetailName = (user, value) => saveDetailRequest(
    user,
    `/api/users/${user.id}`,
    'PATCH',
    { display_name: value },
    'Saved the name.',
  );

  const saveDetailEmail = (user, value) => saveDetailRequest(
    user,
    `/api/users/${user.id}/email`,
    'PATCH',
    { email: value },
    'Saved the email.',
  );

  const saveDetailGithub = (user, value) => saveDetailRequest(
    user,
    `/api/users/${user.id}/github`,
    'PATCH',
    { github: value },
    'Saved the GitHub username.',
  );

  const saveDetailLocation = (user, value) => handleSaveLocation(user, value).then((data) => {
    if (!data) return null;
    if (data.action === 'delete') return data;
    const saved = data.user || {};
    const leftCountry = selectedCountry && saved.country && saved.country !== selectedCountry;
    if (!leftCountry && saved.id != null) rememberDetailUser(saved);
    toast.success('Saved the location.');
    return data;
  }).catch((err) => {
    if (err?.name === 'AbortError') throw err;
    return null;
  });

  const saveDetailLink = (user, url) => saveDetailRequest(
    user,
    `/api/users/${user.id}/socials`,
    'POST',
    { url },
    'Saved the link.',
  );

  const replaceDetailLink = (user, previous, url) => saveDetailRequest(
    user,
    `/api/users/${user.id}/socials`,
    'PATCH',
    { previous_url: previous, url },
    'Saved the link.',
  );

  const removeDetailLink = (user, url) => saveDetailRequest(
    user,
    `/api/users/${user.id}/socials/remove`,
    'POST',
    { url },
    'Removed the link.',
  );

  const openEmailContact = (user) => {
    const seq = mailPreviewSeq.current + 1;
    mailPreviewSeq.current = seq;
    const preferred = lastSenderRef.current || readLastSender();
    setContactModal({
      channel: 'email',
      user,
      loading: true,
      subject: '',
      body: '',
      filename: '',
      templates: [],
      senders: preferred ? [preferred] : [],
      sender: preferred,
    });
    const previewParams = new URLSearchParams();
    if (preferred) previewParams.set('sender', preferred);
    const previewQuery = previewParams.toString();
    Promise.all([
      fetch(
        `/api/users/${user.id}/mail-preview${previewQuery ? `?${previewQuery}` : ''}`
      ).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = body.detail;
          throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
        }
        return body;
      }),
      fetch('/api/templates').then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { templates: [] };
        return body;
      }),
      mailAccounts
        ? Promise.resolve(mailAccounts)
        : fetch('/api/mail-accounts')
            .then(async (res) => {
              const body = await res.json().catch(() => ({}));
              if (!res.ok) return null;
              return body;
            })
            .catch(() => null),
    ])
      .then(([data, templateData, accountsData]) => {
        if (seq !== mailPreviewSeq.current) return;
        const listed = templateData.templates || [];
        const previewTemplates = data.templates || [];
        const templates = listed.length ? listed : previewTemplates;
        const accounts = accountsData?.accounts || mailAccounts?.accounts || [];
        const senders = data.senders || [];
        const sender = chooseSender(senders, preferred, data.sender);
        if (sender) {
          lastSenderRef.current = sender;
          rememberSender(sender);
        }
        const filename = data.filename || templates[0]?.filename || '';
        const chosen = templates.find((item) => item.filename === filename);
        let subject = data.subject || '';
        let body = data.body || '';
        if (chosen && chosen.subject != null) {
          const person = user.display_name || user.name || '';
          const yourName = senderDisplayName(sender, accounts);
          const link = user.link || '';
          subject = renderTemplateText(chosen.subject, person, yourName, link);
          body = renderTemplateText(chosen.body || '', person, yourName, link);
        }
        setContactModal((current) =>
          current && current.user.id === user.id
            ? {
                ...current,
                loading: false,
                subject,
                body,
                filename,
                templates,
                senders,
                sender,
                senderAccounts: accounts,
              }
            : current
        );
      })
      .catch((err) => {
        if (seq !== mailPreviewSeq.current) return;
        toast.error(`Unable to render the mail: ${err.message}`);
        setContactModal(null);
      });
  };

  const openSocialContact = (user, link) => {
    setContactModal({ channel: 'social', user, link, loading: false });
  };

  const reloadMailPreview = ({ sender, template } = {}) => {
    const currentModal = contactModal;
    if (!currentModal || currentModal.channel !== 'email' || !currentModal.user?.id) return;
    const nextSender = sender ?? currentModal.sender ?? '';
    const nextTemplate = template ?? currentModal.filename ?? '';
    if (nextSender) {
      lastSenderRef.current = nextSender;
      rememberSender(nextSender);
    }
    const chosen = (currentModal.templates || []).find((item) => item.filename === nextTemplate);
    if (chosen && chosen.subject != null) {
      const person = currentModal.user.display_name || currentModal.user.name || '';
      const yourName = senderDisplayName(nextSender, currentModal.senderAccounts);
      const link = currentModal.user.link || '';
      setContactModal((current) => {
        if (!current || current.channel !== 'email') return current;
        return {
          ...current,
          sender: nextSender,
          filename: chosen.filename,
          subject: renderTemplateText(chosen.subject, person, yourName, link),
          body: renderTemplateText(chosen.body, person, yourName, link),
        };
      });
      return;
    }
    const seq = mailPreviewSeq.current + 1;
    mailPreviewSeq.current = seq;
    setContactModal((current) => {
      if (!current || current.channel !== 'email') return current;
      return { ...current, sender: nextSender, filename: nextTemplate };
    });
    const params = new URLSearchParams();
    if (nextSender) params.set('sender', nextSender);
    if (nextTemplate) params.set('template', nextTemplate);
    fetch(`/api/users/${currentModal.user.id}/mail-preview?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = body.detail;
          throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
        }
        return body;
      })
      .then((data) => {
        if (seq !== mailPreviewSeq.current) return;
        setContactModal((current) =>
          current && current.channel === 'email'
            ? {
                ...current,
                loading: false,
                subject: data.subject || '',
                body: data.body || '',
                filename: data.filename || nextTemplate,
                templates: data.templates || current.templates || [],
                sender: chooseSender(data.senders || current.senders, nextSender, data.sender),
              }
            : current
        );
      })
      .catch((err) => {
        if (seq !== mailPreviewSeq.current) return;
        toast.error(`Unable to render the mail: ${err.message}`);
        setContactModal((current) => (current ? { ...current, loading: false } : current));
      });
  };

  const saveContact = (status) => {
    if (!contactModal?.user) return;
    const { user, channel, sender } = contactModal;
    if (channel === 'email' && status === 'sent' && !String(sender || '').trim()) {
      toast.error('Choose a sender before marking the mail sent.');
      return;
    }
    setContactModal((current) => (current ? { ...current, saving: true } : current));
    fetch(`/api/users/${user.id}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        status,
        sender_email: channel === 'email' && status === 'sent' ? sender : '',
        template: channel === 'email' ? contactModal.filename || '' : '',
        url: channel === 'social' ? contactModal.link?.url || '' : '',
      }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = body.detail;
          throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
        }
        return body;
      })
      .then((data) => {
        const saved = { ...(data.user || {}) };
        if (channel === 'social' && contactModal.link?.url) {
          const target = String(contactModal.link.url).replace(/\/$/, '').toLowerCase();
          const links = Array.isArray(saved.socials) ? saved.socials : user.socials;
          saved.socials = (Array.isArray(links) ? links : []).map((link) => {
            const key = String(link?.url || '').replace(/\/$/, '').toLowerCase();
            if (key !== target) return link;
            return { ...link, status };
          });
        }
        setUsers((list) =>
          list.map((row) => (row.id === user.id ? { ...row, ...saved } : row))
        );
        if (channel === 'email') {
          loadCountries();
        }
        const name = String(user.display_name || user.name || user.email || 'User').trim();
        const label = status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'cleared';
        const what = channel === 'social' ? socialProviderLabel(contactModal.link?.provider) : 'email';
        toast.success(`${name}: ${what} marked ${label}.`);
        setContactModal(null);
      })
      .catch((err) => {
        toast.error(`Unable to save contact: ${err.message}`);
        setContactModal((current) => (current ? { ...current, saving: false } : current));
      });
  };

  const addTelegramLink = (username) => {
    const user = contactModal?.user;
    const handle = String(username || '').trim();
    if (!user?.id || !handle) return;
    setContactModal((current) => (current ? { ...current, saving: true } : current));
    fetch(`/api/users/${user.id}/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: handle }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = body.detail;
          throw new Error(typeof detail === 'string' ? detail : `HTTP ${res.status}`);
        }
        return body;
      })
      .then((data) => {
        const saved = data.user || {};
        setUsers((list) =>
          list.map((row) => (row.id === user.id ? { ...row, ...saved } : row))
        );
        setContactModal((current) =>
          current && current.user?.id === user.id
            ? { ...current, saving: false, user: { ...current.user, ...saved } }
            : current
        );
        toast.success(
          data.added
            ? `Telegram link added for @${handle}.`
            : `Telegram link for @${handle} is already saved.`
        );
      })
      .catch((err) => {
        toast.error(`Unable to add Telegram: ${err.message}`);
        setContactModal((current) => (current ? { ...current, saving: false } : current));
      });
  };

  const handleOutcomeChange = (user, value) => {
    const previous = user.outcome || 'Waiting';
    if (value === previous || savingOutcomeIds.has(user.id)) {
      return;
    }
    setUsers((list) =>
      list.map((row) => (row.id === user.id ? { ...row, outcome: value } : row))
    );
    setSavingOutcomeIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(user.id);
      return nextIds;
    });
    setError('');
    fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: value }),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            const detail = body.detail;
            const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`;
            throw new Error(message);
          });
        }
        return res.json();
      })
      .then((data) => {
        const saved = data.user || {};
        setUsers((list) =>
          list.map((row) => (row.id === user.id ? { ...row, ...saved, outcome: value } : row))
        );
      })
      .catch((err) => {
        setUsers((list) =>
          list.map((row) =>
            row.id === user.id ? { ...row, outcome: previous } : row
          )
        );
        const message = `Unable to save outcome: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setSavingOutcomeIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(user.id);
          return nextIds;
        });
      });
  };

  const handleToggleFavorite = (user) => {
    if (savingFavoriteIds.has(user.id)) {
      return;
    }
    const next = user.favorite ? 0 : 1;
    setSavingFavoriteIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(user.id);
      return nextIds;
    });
    setUsers((list) => {
      if (view === 'favorites' && !next) {
        return list.filter((row) => row.id !== user.id);
      }
      return list.map((row) => (row.id === user.id ? { ...row, favorite: next } : row));
    });
    if (view === 'favorites' && !next) {
      setTotal((current) => Math.max(0, current - 1));
    }
    setCountries((list) =>
      list.map((row) =>
        row.country === user.country
          ? {
              ...row,
              favorites: Math.max(0, (Number(row.favorites) || 0) + (next ? 1 : -1)),
            }
          : row
      )
    );
    setError('');
    fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: Boolean(next) }),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            const detail = body.detail;
            const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`;
            throw new Error(message);
          });
        }
        return res.json();
      })
      .then(() => {
        loadCountries();
      })
      .catch((err) => {
        const message = `Unable to save favorite: ${err.message}`;
        setError(message);
        toast.error(message);
        loadCountries();
        fetchUsers({ silent: true });
      })
      .finally(() => {
        setSavingFavoriteIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(user.id);
          return nextIds;
        });
      });
  };

  const handleSuppressUser = (user) => {
    if (suppressingIds.has(user.id)) {
      return;
    }
    const name = String(user.display_name || user.name || user.email || 'this user').trim();
    if (
      !window.confirm(
        `Suppress ${name}?\n\nThey will be hidden from the pool. The saved record stays so a later scrape cannot add them again.`
      )
    ) {
      return;
    }
    setSuppressingIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(user.id);
      return nextIds;
    });
    setError('');
    fetch(`/api/users/${user.id}/suppress`, { method: 'POST' })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((body) => {
            const detail = body.detail;
            const message = typeof detail === 'string' ? detail : `HTTP ${res.status}`;
            throw new Error(message);
          });
        }
        return res.json();
      })
      .then(() => {
        toast.success(`Suppressed ${name}.`);
        loadCountries();
        fetchUsers({ silent: true });
      })
      .catch((err) => {
        const message = `Unable to suppress ${name}: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setSuppressingIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(user.id);
          return nextIds;
        });
      });
  };

  const handleScraperPause = (paused) => {
    setLoading(true);
    setError('');
    fetch('/api/scraper/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused, platform: selectedScraper }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      })
      .then((data) => {
        toast.success(paused ? 'Scraper paused.' : 'Scraper resumed.');
        if (data.scraper) {
          applyScraperInfo(data.scraper);
        } else {
          loadScraperInfo();
        }
      })
      .catch((err) => {
        const message = `Unable to update scraper: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  const handleSaveScrapeCap = () => {
    setLoading(true);
    setError('');
    const payload = {
      enabled: capEnabled,
      daily_cap: Number(capInput),
    };
    fetch('/api/scraper/cap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      })
      .then((data) => {
        toast.success(
          capEnabled
            ? `Daily scrape cap set to ${payload.daily_cap}.`
            : 'Daily scrape cap turned off.'
        );
        setCapDirty(false);
        if (data.scraper) {
          const next = data.scraper;
          setScraperInfo(next);
          setCapEnabled(typeof next.cap_enabled === 'boolean' ? next.cap_enabled : capEnabled);
          setCapInput(String(next.daily_cap ?? next.daily_limit ?? payload.daily_cap));
        } else {
          loadScraperInfo();
        }
      })
      .catch((err) => {
        const message = `Unable to save scrape cap: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  const openCreateTemplateModal = (region = '') => {
    setTemplateSaveMode('create');
    setTemplateFilename('');
    setTemplateRegion(region || selectedTemplateRegion || 'etc');
    setTemplateSubject('');
    setTemplateBody('');
    setTemplateModalOpen(true);
  };

  const openEditTemplateModal = (item) => {
    setTemplateSaveMode('update');
    setTemplateFilename(item.filename || '');
    setTemplateRegion(item.region || 'etc');
    setTemplateSubject(item.subject || '');
    setTemplateBody(item.body || '');
    setTemplateModalOpen(true);
  };

  const closeTemplateModal = () => {
    setTemplateModalOpen(false);
    setTemplateSaveMode('create');
    setTemplateFilename('');
    setTemplateSubject('');
    setTemplateBody('');
  };

  const handleSaveTemplate = () => {
    if (!canSaveTemplate) {
      return;
    }
    setLoading(true);
    setError('');
    const isUpdate = templateSaveMode === 'update' && templateFilename;
    const url = isUpdate
      ? `/api/templates/${encodeURIComponent(templateFilename)}`
      : '/api/templates';
    fetch(url, {
      method: isUpdate ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        region: templateRegion,
        subject: templateSubject.trim(),
        body: templateBody,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      })
      .then((data) => {
        const saved = data.template || {};
        toast.success(isUpdate ? 'Template updated.' : 'Template added.');
        closeTemplateModal();
        if (saved.region) {
          setSelectedTemplateRegion(saved.region);
        }
        loadTemplates();
      })
      .catch((err) => {
        const message = `Unable to save template: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  const handleExcludeCountry = (country) => {
    const slug = String(country?.country || '').trim();
    if (!slug || slug === 'noloc') {
      return;
    }
    const name = formatCountryName(slug);
    const total = Number(country.count) || 0;
    const noun = total === 1 ? 'user' : 'users';
    askConfirm({
      title: `Exclude ${name}?`,
      message: `This deletes ${total} ${noun} from the database and stops scraping this country.`,
      confirmLabel: 'Exclude',
    }).then((accepted) => {
      if (!accepted) return;
      excludeCountry(country, name, slug);
    });
  };

  const excludeCountry = (country, name, slug) => {
    setLoading(true);
    setError('');
    fetch(`/api/countries/${encodeURIComponent(slug)}/exclude`, {
      method: 'POST',
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      })
      .then((data) => {
        const deleted = Number(data.deleted) || 0;
        toast.success(
          `Excluded ${name}. Deleted ${deleted} ${deleted === 1 ? 'user' : 'users'}.`
        );
        if (selectedCountry === slug) {
          setSelectedCountry('');
          setUsers([]);
          setTotal(0);
          setPage(1);
        }
        loadCountries();
        if (selectedCountry !== slug) {
          fetchUsers({ silent: true });
        }
      })
      .catch((err) => {
        const message = `Unable to exclude ${name}: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  const handleDeleteTemplate = (item) => {
    if (!item?.filename) {
      return;
    }
    const label = item.subject ? `"${item.subject}"` : 'this template';
    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }
    setLoading(true);
    setError('');
    fetch(`/api/templates/${encodeURIComponent(item.filename)}`, {
      method: 'DELETE',
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const detail = data.detail || res.statusText;
          throw new Error(typeof detail === 'string' ? detail : 'Request failed');
        }
        return data;
      })
      .then(() => {
        toast.success('Template deleted.');
        if (templateFilename === item.filename) {
          closeTemplateModal();
        }
        loadTemplates();
      })
      .catch((err) => {
        const message = `Unable to delete template: ${err.message}`;
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };
  return {
    view,
    setView,
    contactModal,
    setContactModal,
    detailUser,
    openUserDetail,
    closeUserDetail,
    saveDetailName,
    saveDetailEmail,
    saveDetailLocation,
    saveDetailGithub,
    saveDetailLink,
    replaceDetailLink,
    removeDetailLink,
    countries,
    setCountries,
    selectedCountry,
    setSelectedCountry,
    query,
    setQuery,
    socialFilters,
    setSocialFilters,
    users,
    setUsers,
    total,
    setTotal,
    page,
    setPage,
    pageSize,
    loading,
    setLoading,
    error,
    setError,
    mailAccounts,
    setMailAccounts,
    mailEmail,
    setMailEmail,
    mailSenderName,
    setMailSenderName,
    mailSaveMode,
    setMailSaveMode,
    mailModalOpen,
    setMailModalOpen,
    scraperInfo,
    setScraperInfo,
    selectedScraper,
    setSelectedScraper,
    capEnabled,
    setCapEnabled,
    capInput,
    setCapInput,
    capDirty,
    setCapDirty,
    displayNameDrafts,
    setDisplayNameDrafts,
    savingDisplayNameIds,
    setSavingDisplayNameIds,
    editingDisplayNameId,
    setEditingDisplayNameId,
    savingOutcomeIds,
    setSavingOutcomeIds,
    savingFavoriteIds,
    suppressingIds,
    setSuppressingIds,
    templates,
    setTemplates,
    templateCatalog,
    setTemplateCatalog,
    selectedTemplateRegion,
    setSelectedTemplateRegion,
    templateModalOpen,
    setTemplateModalOpen,
    templateSaveMode,
    setTemplateSaveMode,
    templateFilename,
    setTemplateFilename,
    templateRegion,
    setTemplateRegion,
    templateSubject,
    setTemplateSubject,
    templateBody,
    setTemplateBody,
    loadMailAccounts,
    applyScraperInfo,
    loadScraperInfo,
    loadTemplates,
    loadCountries,
    selectedSocials,
    fetchUsers,
    searchQuery,
    pageCount,
    mailAccountsData,
    accounts,
    sortedCountries,
    sidebarCountries,
    sidebarTotal,
    selectedCountryMeta,
    trimmedMailEmail,
    isEditMode,
    canSaveMailAccount,
    templateGroups,
    templateCountries,
    templateCustom,
    selectedGroupMeta,
    selectedMatchHint,
    editingGroupMeta,
    editingMatchHint,
    visibleTemplates,
    canSaveTemplate,
    templateSidebarCountries,
    templateSidebarCustom,
    handleResetMailForm,
    openCreateMailModal,
    openEditMailModal,
    closeMailModal,
    handleAddMailAccount,
    handleDeleteMailAccount,
    displayNameValue,
    handleDisplayNameChange,
    handleCancelDisplayName,
    handleSaveDisplayName,
    handleSaveLocation,
    openEmailContact,
    openSocialContact,
    reloadMailPreview,
    saveContact,
    addTelegramLink,
    handleOutcomeChange,
    handleToggleFavorite,
    handleSuppressUser,
    handleScraperPause,
    handleSaveScrapeCap,
    openCreateTemplateModal,
    openEditTemplateModal,
    closeTemplateModal,
    handleSaveTemplate,
    handleExcludeCountry,
    confirmPrompt,
    closeConfirm,
    handleDeleteTemplate,
  };
}
