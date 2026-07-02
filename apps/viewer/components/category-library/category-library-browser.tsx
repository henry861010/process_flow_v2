"use client";

import * as React from "react";
import { ChevronRight, Folder, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  filterCategorySearchResults,
  getAutoResolvedCategoryPath,
  getCategoryHierarchyLevel,
  type CategoryFolder,
  type CategoryRecord,
} from "@/lib/category-library";
import { cn } from "@/lib/utils";

type CategoryLibraryRenderContext = {
  showCategoryPath: boolean;
};

type CategoryLibraryBrowserProps<T extends CategoryRecord> = {
  items: T[];
  path: string[];
  search: string;
  searchPlaceholder: string;
  emptyLabel: React.ReactNode;
  noSearchResultsLabel: React.ReactNode;
  noCategoryItemsLabel: React.ReactNode;
  getSearchText: (item: T) => string;
  itemKey: (item: T) => string;
  renderItem: (item: T, context: CategoryLibraryRenderContext) => React.ReactNode;
  onPathChange: (path: string[]) => void;
  onSearchChange: (value: string) => void;
  className?: string;
  itemListClassName?: string;
};

export function CategoryLibraryBrowser<T extends CategoryRecord>({
  items,
  path,
  search,
  searchPlaceholder,
  emptyLabel,
  noSearchResultsLabel,
  noCategoryItemsLabel,
  getSearchText,
  itemKey,
  renderItem,
  onPathChange,
  onSearchChange,
  className,
  itemListClassName = "flex flex-col gap-2",
}: CategoryLibraryBrowserProps<T>) {
  const resolvedPath = React.useMemo(
    () => getAutoResolvedCategoryPath(items, path),
    [items, path],
  );
  const level = React.useMemo(
    () => getCategoryHierarchyLevel(items, resolvedPath),
    [items, resolvedPath],
  );
  const searchResults = React.useMemo(
    () => filterCategorySearchResults(items, search, getSearchText),
    [getSearchText, items, search],
  );
  const searching = search.trim().length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <label className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
        />
      </label>

      {items.length === 0 ? (
        <CategoryLibraryEmptyState>{emptyLabel}</CategoryLibraryEmptyState>
      ) : searching ? (
        searchResults.length === 0 ? (
          <CategoryLibraryEmptyState>{noSearchResultsLabel}</CategoryLibraryEmptyState>
        ) : (
          <div className={itemListClassName}>
            {searchResults.map((item) => (
              <React.Fragment key={itemKey(item)}>
                {renderItem(item, { showCategoryPath: true })}
              </React.Fragment>
            ))}
          </div>
        )
      ) : (
        <>
          <CategoryBreadcrumb path={level.path} onPathChange={onPathChange} />
          {level.folders.length === 0 && level.items.length === 0 ? (
            <CategoryLibraryEmptyState>{noCategoryItemsLabel}</CategoryLibraryEmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {level.folders.map((folder) => (
                <CategoryFolderButton
                  key={folder.path.join(".")}
                  folder={folder}
                  onClick={() => onPathChange(folder.path)}
                />
              ))}
              {level.items.length > 0 ? (
                <div className={itemListClassName}>
                  {level.items.map((item) => (
                    <React.Fragment key={itemKey(item)}>
                      {renderItem(item, { showCategoryPath: false })}
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryBreadcrumb({
  path,
  onPathChange,
}: {
  path: string[];
  onPathChange: (path: string[]) => void;
}) {
  return (
    <nav
      aria-label="Category path"
      className="flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap px-0.5 text-xs text-muted-foreground"
    >
      <button
        type="button"
        className="shrink-0 rounded-sm px-1 py-0.5 font-medium text-primary hover:bg-muted"
        onClick={() => onPathChange([])}
      >
        Root
      </button>
      {path.map((segment, index) => (
        <React.Fragment key={`${segment}-${index}`}>
          <span aria-hidden="true" className="shrink-0 text-muted-foreground/70">
            /
          </span>
          <button
            type="button"
            className="min-w-0 rounded-sm px-1 py-0.5 font-medium text-primary hover:bg-muted"
            onClick={() => onPathChange(path.slice(0, index + 1))}
          >
            <span className="block max-w-[7rem] truncate">{segment}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

function CategoryFolderButton({
  folder,
  onClick,
}: {
  folder: CategoryFolder;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-left text-sm shadow-sm transition hover:border-primary/60 hover:bg-muted/20"
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Folder className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate font-medium">{folder.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary">{folder.count}</Badge>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </span>
    </button>
  );
}

function CategoryLibraryEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
