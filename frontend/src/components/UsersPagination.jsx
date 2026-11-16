import { useEffect, useState } from 'react';
import ReactPaginate from 'react-paginate';
import ui from '../styles/ui.module.css';

export const UsersPagination = ({ page, pageCount, onPageChange }) => {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => {
    setDraft(String(page));
  }, [page]);
  if (pageCount <= 1) {
    return null;
  }
  const goToPage = (event) => {
    event.preventDefault();
    const value = Number.parseInt(String(draft).trim(), 10);
    if (!Number.isFinite(value)) {
      setDraft(String(page));
      return;
    }
    const next = Math.min(pageCount, Math.max(1, value));
    setDraft(String(next));
    if (next !== page) {
      onPageChange(next);
    }
  };
  return (
    <div className={ui['pagination-bar']}>
      <ReactPaginate
      breakLabel="…"
      nextLabel="Next"
      previousLabel="Previous"
      onPageChange={(event) => onPageChange(event.selected + 1)}
      forcePage={Math.max(0, page - 1)}
      pageRangeDisplayed={3}
      marginPagesDisplayed={1}
      pageCount={pageCount}
      renderOnZeroPageCount={null}
      containerClassName={ui['pagination']}
      pageClassName={ui['pagination-item']}
      pageLinkClassName={ui['pagination-link']}
      previousClassName={ui['pagination-item']}
      previousLinkClassName={ui['pagination-link']}
      nextClassName={ui['pagination-item']}
      nextLinkClassName={ui['pagination-link']}
      breakClassName={ui['pagination-item']}
      breakLinkClassName={ui['pagination-link']}
      activeClassName={ui['active']}
        disabledClassName={ui['disabled']}
      />
      {pageCount > 10 ? (
        <form className={ui['pagination-goto']} onSubmit={goToPage}>
          <label>
            Page
            <input
              type="number"
              min={1}
              max={pageCount}
              inputMode="numeric"
              aria-label="Go to page"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit">Go</button>
        </form>
      ) : null}
    </div>
  );
};
