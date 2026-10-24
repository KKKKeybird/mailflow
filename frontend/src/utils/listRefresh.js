// The backend caps a page at 500 rows; asking for more makes the list silently shrink.
const MAX_LIMIT = 500;

// Which rows a background refresh (new mail, sync, flag changes) reloads.
//
// Paginated mode reloads the page on screen. Infinite mode reloads everything already scrolled
// into view, and never less than one page: the loaded count is a floor, not the window. A list
// that first loaded 1 message (a new account, or a nearly empty folder) otherwise asked for
// limit=1 on every refresh after it, so mail arriving next never showed until a reload (#682).
export function refreshListWindow({ scrollMode, currentPage = 1, pageSize, loadedCount = 0 }) {
  const size = Math.max(1, Number(pageSize) || 50);
  if (scrollMode === 'paginated') {
    const page = Math.max(1, Number(currentPage) || 1);
    return { limit: size, offset: (page - 1) * size };
  }
  return { limit: Math.min(Math.max(Number(loadedCount) || 0, size), MAX_LIMIT), offset: 0 };
}
