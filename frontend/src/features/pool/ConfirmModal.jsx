import Modal from 'react-modal';
import { useDashboard } from '../../app/DashboardContext';
import { cls } from '../../styles/cls';
import ui from '../../styles/ui.module.css';
import modal from '../../styles/modal.module.css';

export function ConfirmModal() {
  const { confirmPrompt, closeConfirm } = useDashboard();
  return (
    <Modal
      isOpen={Boolean(confirmPrompt)}
      onRequestClose={() => closeConfirm(false)}
      contentLabel={confirmPrompt?.title || 'Confirm'}
      className={cls(modal, 'mail-modal')}
      overlayClassName={cls(modal, 'mail-modal-overlay')}
    >
      {confirmPrompt ? (
        <>
          <div className={cls(modal, 'mail-modal-header')}>
            <h3>{confirmPrompt.title}</h3>
          </div>
          <p className={cls(modal, 'confirm-copy')}>{confirmPrompt.message}</p>
          <div className={cls(ui, 'form-actions-row form-actions-end')}>
            <button
              type="button"
              className={cls(ui, 'secondary-button')}
              onClick={() => closeConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cls(ui, 'delete-button')}
              onClick={() => closeConfirm(true)}
            >
              {confirmPrompt.confirmLabel || 'Exclude'}
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
