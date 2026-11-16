import { IconHeart } from '../../components/Icons';
import { SocialIcon } from '../../components/SocialIcon';
import { UsersPagination } from '../../components/UsersPagination';
import { LocationEditor } from './LocationEditor';
import { SourceMark } from './SourceMark';
import { useDashboard } from '../../app/DashboardContext';
import { OUTCOMES } from '../../lib/constants';
import { formatDate, formatUpdatedAgo, formatCountryName } from '../../lib/format';
import { userSources } from '../../lib/source';
import { socialItemsForUser, SOCIAL_ACCOUNT_FILTERS, socialProviderLabel, contactTone } from '../../lib/social';
import { cls } from '../../styles/cls';
import layout from '../../styles/layout.module.css';
import ui from '../../styles/ui.module.css';
import pool from '../../styles/pool.module.css';

export function PoolView() {
  const {
    view,
    countries,
    selectedCountry,
    setSelectedCountry,
    query,
    setQuery,
    socialFilters,
    setSocialFilters,
    users,
    total,
    page,
    setPage,
    loading,
    error,
    savingDisplayNameIds,
    editingDisplayNameId,
    setEditingDisplayNameId,
    savingOutcomeIds,
    suppressingIds,
    savingFavoriteIds,
    selectedSocials,
    searchQuery,
    pageCount,
    sidebarCountries,
    sidebarTotal,
    selectedCountryMeta,
    displayNameValue,
    handleDisplayNameChange,
    handleCancelDisplayName,
    handleSaveDisplayName,
    handleSaveLocation,
    openEmailContact,
    openSocialContact,
    handleOutcomeChange,
    handleSuppressUser,
    handleToggleFavorite,
    handleExcludeCountry,
    openUserDetail,
  } = useDashboard();
  const poolLike = view === 'pool' || view === 'favorites';
  const allSocialsOn = SOCIAL_ACCOUNT_FILTERS.every((item) => socialFilters[item.id]);
  const someSocialsOn = SOCIAL_ACCOUNT_FILTERS.some((item) => socialFilters[item.id]);
  return (
    <>
        {(view === 'pool' || view === 'favorites' || view === 'tracked') && (
          <section className={cls(layout, "users-layout")}>
            <aside className={`${cls(ui, "card")} ${cls(layout, "countries-sidebar")}`}>
              <div className={cls(layout, "countries-sidebar-header")}>Countries</div>
              <div className={cls(layout, "countries-list")} role="listbox" aria-label="Countries">
                <button
                  type="button"
                  role="option"
                  aria-selected={!selectedCountry}
                  className={cls(layout, !selectedCountry
                      ? 'country-list-item active'
                      : 'country-list-item')}
                  onClick={() => {
                    setSelectedCountry('');
                    setPage(1);
                  }}
                >
                  <div className={cls(layout, "country-list-top")}>
                    <span className={cls(layout, "country-list-name")}>All countries</span>
                    <span className={cls(layout, "country-list-count")}>{sidebarTotal}</span>
                  </div>
                </button>
                {sidebarCountries.length === 0 ? (
                  <div className={cls(layout, "countries-empty")}>
                    {view === 'tracked'
                      ? 'No sent mail yet'
                      : view === 'favorites'
                        ? 'No favorite users yet'
                        : 'No countries yet'}
                  </div>
                ) : (
                  sidebarCountries.map((country) => {
                    const active = selectedCountry === country.country;
                    const total = Number(country.count) || 0;
                    const sent = Number(country.sent) || 0;
                    const pct =
                      total > 0
                        ? Math.min(100, Math.round((sent / total) * 1000) / 10)
                        : 0;
                    return (
                      <div
                        key={country.country}
                        className={cls(layout, active ? 'country-list-item active' : 'country-list-item')}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={cls(layout, "country-list-select")}
                          onClick={() => {
                            setSelectedCountry(country.country);
                            setPage(1);
                          }}
                        >
                          <div className={cls(layout, "country-list-top")}>
                            <span className={cls(layout, "country-list-name")}>
                              {formatCountryName(country.country)}
                            </span>
                            <span className={cls(layout, "country-list-count")}>
                              {view === 'tracked'
                                ? sent
                                : view === 'favorites'
                                  ? Number(country.favorites) || 0
                                  : `${sent}/${total}`}
                            </span>
                          </div>
                          {view === 'tracked' || view === 'favorites' ? null : (
                          <div
                            className={cls(layout, "country-progress")}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={total || 100}
                            aria-valuenow={sent}
                            aria-label={`${sent} of ${total} mailed in ${formatCountryName(country.country)}`}
                          >
                            <div
                              className={cls(layout, "country-progress-fill")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          )}
                        </button>
                        {country.country !== 'noloc' ? (
                          <button
                            type="button"
                            className={cls(layout, "country-exclude-button")}
                            title={`Exclude ${formatCountryName(country.country)}`}
                            aria-label={`Exclude ${formatCountryName(country.country)}`}
                            disabled={loading}
                            onClick={() => handleExcludeCountry(country)}
                          >
                            <span className={cls(layout, "country-exclude-bar")} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </aside>

            <div className={cls(layout, "users-main")}>
              <div className={`${cls(ui, "card")} ${"users-toolbar"}`}>
                <div className={cls(pool, "users-toolbar-row")}>
                  <label className={cls(pool, "users-search-field")}>
                    Search
                    <input
                      type="search"
                      placeholder={
                        selectedCountry
                          ? 'Search name, email, @username, link, GitHub or location'
                          : 'Search all users by name, email, @username or GitHub'
                      }
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  {poolLike ? (
                    <fieldset className={cls(pool, "social-account-filters")}>
                      <legend>
                        <span className={cls(pool, "social-account-legend")}>
                          Has account
                          <label className={cls(pool, allSocialsOn ? 'social-account-all is-on' : 'social-account-all')}>
                            <input
                              ref={(node) => {
                                if (node) node.indeterminate = someSocialsOn && !allSocialsOn;
                              }}
                              type="checkbox"
                              checked={allSocialsOn}
                              onChange={() => {
                                const next = !allSocialsOn;
                                setSocialFilters(
                                  Object.fromEntries(
                                    SOCIAL_ACCOUNT_FILTERS.map((item) => [item.id, next]),
                                  ),
                                );
                                setPage(1);
                              }}
                            />
                            All
                          </label>
                        </span>
                      </legend>
                      <div className={cls(pool, "social-account-filter-list")}>
                        {SOCIAL_ACCOUNT_FILTERS.map((item) => (
                          <label
                            key={item.id}
                            className={cls(pool, socialFilters[item.id]
                                ? 'social-account-filter is-on'
                                : 'social-account-filter')}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(socialFilters[item.id])}
                              onChange={() => {
                                setSocialFilters((current) => ({
                                  ...current,
                                  [item.id]: !current[item.id],
                                }));
                                setPage(1);
                              }}
                            />
                            <SocialIcon provider={item.id} />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                </div>
                <div className={cls(pool, "summary-row")}>
                  <div>
                    <strong>Selected:</strong>{' '}
                    {selectedCountry
                      ? `${formatCountryName(selectedCountry)}${
                          selectedCountryMeta
                            ? ` (${
                                view === 'tracked'
                                  ? Number(selectedCountryMeta.sent) || 0
                                  : view === 'favorites'
                                    ? Number(selectedCountryMeta.favorites) || 0
                                    : selectedCountryMeta.count
                              })`
                            : ''
                        }`
                      : 'All countries'}
                  </div>
                  <div>
                    <strong>Users found:</strong> {total}
                  </div>
                </div>
              </div>

              <div className={`${cls(ui, "card")} ${cls(pool, "table-card")}`}>
                {error && <div className={cls(ui, "alert")}>{error}</div>}
                {loading ? (
                  <div className={cls(ui, "empty-state")}>Loading users...</div>
                ) : users.length === 0 ? (
                  <div className={cls(ui, "empty-state")}>
                    {searchQuery || selectedSocials.length
                      ? 'No users match this search.'
                      : view === 'tracked'
                        ? 'No tracked users yet.'
                        : view === 'favorites'
                          ? 'No favorite users.'
                          : 'No users.'}
                  </div>
                ) : (
                  <>
                    <UsersPagination
                      page={page}
                      pageCount={pageCount}
                      onPageChange={setPage}
                    />

                    <div className={cls(pool, "table-scroll")}>
                      <table className={cls(pool, "users-table")}>
                        <thead>
                          <tr>
                            {poolLike ? <th className={cls(pool, "favorite-cell")} /> : null}
                            <th>Source</th>
                            {poolLike ? <th>Social</th> : null}
                            <th>Name</th>
                            <th>Email</th>
                            {poolLike ? null : <th>Sender</th>}
                            {!selectedCountry ? <th>Country</th> : null}
                            <th>Location</th>
                            {poolLike ? null : <th>Outcome</th>}
                            {poolLike ? null : <th>Updated</th>}
                            <th className={cls(pool, "row-action-cell")} />
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((user) => (
                            <tr
                              key={user.id}
                              className={cls(pool, 'clickable-row')}
                              onClick={(event) => {
                                if (event.target.closest('button, a, input, select, textarea, label')) return;
                                openUserDetail(user);
                              }}
                            >
                              {poolLike ? (
                                <td className={cls(pool, "favorite-cell")}>
                                  <button
                                    type="button"
                                    className={cls(pool, user.favorite
                                      ? 'favorite-button is-on'
                                      : 'favorite-button')}
                                    title={user.favorite ? 'Remove favorite' : 'Favorite'}
                                    aria-label={user.favorite ? 'Remove favorite' : 'Favorite'}
                                    aria-pressed={Boolean(user.favorite)}
                                    disabled={savingFavoriteIds.has(user.id)}
                                    onClick={() => handleToggleFavorite(user)}
                                  >
                                    <IconHeart filled={Boolean(user.favorite)} />
                                  </button>
                                </td>
                              ) : null}
                              <td>
                                {userSources(user).length ? (
                                  <span className={cls(pool, "source-links")}>
                                    {userSources(user).map((source) => (
                                      <SourceMark key={source} source={source} user={user} />
                                    ))}
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                              {poolLike ? (
                              <td>
                                {socialItemsForUser(user).length ? (
                                  <span className={cls(pool, "social-links")}>
                                    {socialItemsForUser(user).map((item) => (
                                      <button
                                        key={item.url}
                                        type="button"
                                        className={cls(pool, `social-link contact-${contactTone(item.status)}`)}
                                        title={`${socialProviderLabel(item.provider)} · ${item.url}`}
                                        aria-label={`${socialProviderLabel(item.provider)} ${item.url}`}
                                        onClick={() => openSocialContact(user, item)}
                                      >
                                        <SocialIcon provider={item.provider} />
                                      </button>
                                    ))}
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                              ) : null}
                              <td className={cls(pool, "display-name-cell")}>
                                {!poolLike ? (
                                  user.display_name || user.name || '-'
                                ) : (
                                <input
                                  type="text"
                                  className={cls(pool, editingDisplayNameId === user.id
                                      ? 'display-name-input is-editing'
                                      : 'display-name-input')}
                                  value={displayNameValue(user)}
                                  disabled={savingDisplayNameIds.has(user.id)}
                                  maxLength={200}
                                  aria-label={`Display name for user ${user.id}`}
                                  placeholder={user.name || 'Name'}
                                  onFocus={() => setEditingDisplayNameId(user.id)}
                                  onChange={(event) =>
                                    handleDisplayNameChange(user.id, event.target.value)
                                  }
                                  onBlur={() => {
                                    handleSaveDisplayName(user);
                                    setEditingDisplayNameId((current) =>
                                      current === user.id ? null : current
                                    );
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.currentTarget.blur();
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      handleCancelDisplayName(user.id);
                                      event.currentTarget.blur();
                                    }
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                />
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className={cls(pool, `contact-email contact-${contactTone(user.mail_status)}`)}
                                  title={user.sender_email ? `Sender ${user.sender_email}` : 'Email not sent'}
                                  onClick={() => openEmailContact(user)}
                                >
                                  {user.email}
                                </button>
                              </td>
                              {poolLike ? null : (
                                <td title={user.sender_email || ''}>
                                  {user.sender_email || '-'}
                                </td>
                              )}
                              {!selectedCountry ? (
                                <td>{formatCountryName(user.country) || '-'}</td>
                              ) : null}
                              <td className={cls(pool, "location-cell")}>
                                <LocationEditor
                                  user={user}
                                  onCommit={handleSaveLocation}
                                />
                              </td>
                              {poolLike ? null : (
                              <td className={cls(pool, "outcome-cell")}>
                                <select
                                  className={cls(pool, "outcome-select")}
                                  value={user.outcome || 'Waiting'}
                                  disabled={savingOutcomeIds.has(user.id)}
                                  aria-label={`Outcome for user ${user.id}`}
                                  onChange={(event) =>
                                    handleOutcomeChange(user, event.target.value)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {OUTCOMES.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              )}
                              {poolLike ? null : (
                              <td title={formatDate(user.updated_at)}>
                                {formatUpdatedAgo(user.updated_at)}
                              </td>
                              )}
                              <td className={cls(pool, "row-action-cell")}>
                                <span className={cls(pool, "row-actions")}>
                                  <button
                                    type="button"
                                    className={cls(pool, "edit-button")}
                                    onClick={() => openUserDetail(user)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className={cls(pool, "suppress-button")}
                                    title="Suppress"
                                    aria-label="Suppress"
                                    disabled={suppressingIds.has(user.id)}
                                    onClick={() => handleSuppressUser(user)}
                                  >
                                    <span className={cls(pool, "suppress-cross")} aria-hidden="true" />
                                  </button>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <UsersPagination
                      page={page}
                      pageCount={pageCount}
                      onPageChange={setPage}
                    />
                  </>
                )}
              </div>
            </div>
          </section>
        )}
    </>
  );
}
