import Modal from 'react-modal';
import { useDashboard } from '../../app/DashboardContext';
import { formatDateOnly, maskEmail } from '../../lib/format';
import { cls } from '../../styles/cls';
import ui from '../../styles/ui.module.css';
import pool from '../../styles/pool.module.css';
import modal from '../../styles/modal.module.css';
import settings from '../../styles/settings.module.css';

export function SettingsView() {
  const {
    view,
    loading,
    error,
    mailAccounts,
    mailEmail,
    setMailEmail,
    mailSenderName,
    setMailSenderName,
    mailModalOpen,
    accounts,
    isEditMode,
    canSaveMailAccount,
    openCreateMailModal,
    openEditMailModal,
    closeMailModal,
    handleAddMailAccount,
    handleDeleteMailAccount,
  } = useDashboard();

  return (
    <>
        {view === 'senders' && (
          <section className={`${cls(ui, "card")} ${"status-card"}`}>
            <h2>Settings</h2>
            {error && <div className={cls(ui, "alert")}>{error}</div>}
            {!mailAccounts ? (
              <div className={cls(ui, "empty-state")}>Loading mail account info...</div>
            ) : (
              <>
                <div className={cls(ui, "section-block")}>
                  <div className={cls(ui, "section-header mail-accounts-header")}>
                    <div>
                      <h3>Sender addresses</h3>
                    </div>
                    <button type="button" onClick={openCreateMailModal}>
                      Add sender
                    </button>
                  </div>
                  {accounts.length > 0 ? (
                    <div className={cls(pool, "table-scroll")}>
                      <table className={cls(settings, "accounts-table")}>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Sent</th>
                            <th>Added</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map((account) => (
                            <tr key={account.email}>
                              <td>{account.sender_name || ''}</td>
                              <td>
                                <span title={account.email}>{maskEmail(account.email)}</span>
                              </td>
                              <td>{Number(account.sent_total) || 0}</td>
                              <td>{formatDateOnly(account.created_at)}</td>
                              <td>
                                <button
                                  type="button"
                                  className={cls(ui, "secondary-button table-action-button")}
                                  onClick={() => openEditMailModal(account)}
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={cls(ui, "empty-state")}>No senders configured</div>
                  )}
                </div>

              </>
            )}

            <Modal
              isOpen={mailModalOpen}
              onRequestClose={closeMailModal}
              contentLabel={isEditMode ? 'Edit sender' : 'Add sender'}
              className={cls(modal, "mail-modal")}
              overlayClassName={cls(modal, "mail-modal-overlay")}
            >
              <div className={cls(modal, "mail-modal-header")}>
                <h3>{isEditMode ? 'Edit sender' : 'Add sender'}</h3>
                <button
                  type="button"
                  className={cls(ui, "secondary-button")}
                  onClick={closeMailModal}
                >
                  Close
                </button>
              </div>
              <label>
                Sender name
                <input
                  type="text"
                  value={mailSenderName}
                  onChange={(event) => setMailSenderName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label>
                Gmail address
                <input
                  type="email"
                  value={mailEmail}
                  onChange={(event) => setMailEmail(event.target.value)}
                  placeholder="your-account@gmail.com"
                  disabled={isEditMode}
                />
              </label>
              <div className={cls(ui, "form-actions-row")}>
                <button
                  type="button"
                  onClick={handleAddMailAccount}
                  disabled={!canSaveMailAccount}
                >
                  {isEditMode ? 'Update account' : 'Add account'}
                </button>
                {isEditMode && (
                  <button
                    type="button"
                    className={cls(ui, "delete-button")}
                    onClick={handleDeleteMailAccount}
                    disabled={loading}
                  >
                    Delete account
                  </button>
                )}
              </div>
            </Modal>
          </section>
        )}
    </>
  );
}
