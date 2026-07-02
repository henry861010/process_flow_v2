export type GeometryCategoryRecord = {
  category: string;
};

export type GeometryCategoryFolder = {
  name: string;
  path: string[];
  count: number;
};

export type GeometryHierarchyLevel<T extends GeometryCategoryRecord> = {
  path: string[];
  folders: GeometryCategoryFolder[];
  geometries: T[];
};

export function getGeometryCategoryPath(category: string) {
  const segments = category
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : ["uncategorized"];
}

export function formatGeometryCategoryPath(category: string) {
  return getGeometryCategoryPath(category).join(" / ");
}

export function getGeometryHierarchyLevel<T extends GeometryCategoryRecord>(
  geometries: T[],
  path: string[],
): GeometryHierarchyLevel<T> {
  const folders = new Map<string, GeometryCategoryFolder>();
  const directGeometries: T[] = [];

  geometries.forEach((geometry) => {
    const categoryPath = getGeometryCategoryPath(geometry.category);
    if (!pathIsPrefix(path, categoryPath)) {
      return;
    }

    if (categoryPath.length === path.length) {
      directGeometries.push(geometry);
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
    geometries: directGeometries,
  };
}

export function getAutoResolvedGeometryPath<T extends GeometryCategoryRecord>(
  geometries: T[],
  initialPath: string[],
) {
  let path = [...initialPath];
  let level = getGeometryHierarchyLevel(geometries, path);

  while (level.geometries.length === 0 && level.folders.length === 1) {
    path = level.folders[0].path;
    level = getGeometryHierarchyLevel(geometries, path);
  }

  return path;
}

export function filterGeometrySearchResults<T>(
  geometries: T[],
  query: string,
  getSearchText: (geometry: T) => string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return geometries.filter((geometry) =>
    getSearchText(geometry).toLowerCase().includes(normalizedQuery),
  );
}

function pathIsPrefix(prefix: string[], path: string[]) {
  if (prefix.length > path.length) {
    return false;
  }

  return prefix.every((segment, index) => segment === path[index]);
}
