"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreateProjectDialog } from "./create-project-dialog";
import { legacyImportedKey, readLegacyState } from "../lib/local-drafts";

export function LegacyMapImport({ ownerId }: { ownerId: string }) {
  const [legacy, setLegacy] = useState(() => {
    try {
      return localStorage.getItem(legacyImportedKey(ownerId))
        ? null
        : readLegacyState();
    } catch {
      return null;
    }
  });
  function finishImport() {
    try {
      localStorage.setItem(legacyImportedKey(ownerId), "true");
    } catch {
      /* Keep the legacy map recoverable. */
    }
    setLegacy(null);
  }
  if (!legacy) return null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-medium">You have a map saved in this browser</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Import it to keep working on it as a project.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={finishImport}>
            Dismiss
          </Button>
          <CreateProjectDialog
            initialState={legacy}
            onCreated={finishImport}
            label="Import existing map"
          />
        </div>
      </CardContent>
    </Card>
  );
}
