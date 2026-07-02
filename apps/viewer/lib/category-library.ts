export type CategoryRecord = {
  category: string;
};

export type CategoryFolder = {
  name: string;
  path: string[];
  count: number;
};

export type CategoryHierarchyLevel<T extends CategoryRecord> = {
  path: string[];
  folders: CategoryFolder[];
  items: T[];
};

export function getCategoryPath(category: string) {
  const segments = category
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : ["uncategorized"];
}

export function formatCategoryPath(category: string) {
  return getCategoryPath(category).join(" / ");
}

export function getCategoryHierarchyLevel<T extends CategoryRecord>(
  items: T[],
  path: string[],
): CategoryHierarchyLevel<T> {
  const folders = new Map<string, CategoryFolder>();
  const directItems: T[] = [];

  items.forEach((item) => {
    const categoryPath = getCategoryPath(item.category);
    if (!pathIsPrefix(path, categoryPath)) {
      return;
    }

    if (categoryPath.length === path.length) {
      directItems.push(item);
      return;
    }

    const folderName = categoryPath[path.length];
    const existingFolder = folders.get(folderName);
    if (existingFolder) {
      existingFolder.count += 1;
      return;
    }

    folders.set(folderName, {
      name: folderName,
      path: [...path, folderName],
      count: 1,
    });
  });

  return {
    path: [...path],
    folders: Array.from(folders.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    items: directItems,
  };
}

export function getAutoResolvedCategoryPath<T extends CategoryRecord>(
  items: T[],
  initialPath: string[],
) {
  let path = [...initialPath];
  let level = getCategoryHierarchyLevel(items, path);

  while (level.items.length === 0 && level.folders.length === 1) {
    path = level.folders[0].path;
    level = getCategoryHierarchyLevel(items, path);
  }

  return path;
}

export function filterCategorySearchResults<T>(
  items: T[],
  query: string,
  getSearchText: (item: T) => string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return items.filter((item) =>
    getSearchText(item).toLowerCase().includes(normalizedQuery),
  );
}

function pathIsPrefix(prefix: string[], path: string[]) {
  if (prefix.length > path.length) {
    return false;
  }

  return prefix.every((segment, index) => segment === path[index]);
}
