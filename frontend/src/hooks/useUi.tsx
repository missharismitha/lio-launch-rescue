import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type TabId = 'brief' | 'agent' | 'numbers' | 'messages' | 'offer' | 'health';
export type ApprovalTarget = 'supplier' | 'escalation';

interface Ui {
  sheetOpen: boolean;
  tab: TabId;
  openerId: string;
  approval: ApprovalTarget | null;
  demoOpen: boolean;
  /* guided demo: id of the scene being narrated (null when none) and whether it is playing (not paused) */
  demoScene: string | null;
  demoPlaying: boolean;
  setDemoScene: (id: string | null) => void;
  setDemoPlaying: (p: boolean) => void;
  openSheet: (tab: TabId, openerId?: string) => void;
  closeSheet: () => void;
  setTab: (t: TabId) => void;
  setSheetOpen: (o: boolean) => void;
  startApproval: (target: ApprovalTarget, openerId?: string) => void;
  endApproval: () => void;
  setDemoOpen: (o: boolean) => void;
}

const Ctx = createContext<Ui | null>(null);
export const useUi = (): Ui => {
  const v = useContext(Ctx);
  if (!v) throw new Error('UiProvider missing');
  return v;
};

/* tolerant read for visual components that may render without the provider (tests, embeds) */
export const useDemoState = (): { demoScene: string | null; demoPlaying: boolean } => {
  const v = useContext(Ctx);
  return { demoScene: v?.demoScene ?? null, demoPlaying: v?.demoPlaying ?? false };
};

export function UiProvider({ children }: { children: ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('brief');
  const [openerId, setOpenerId] = useState('details');
  const [approval, setApproval] = useState<ApprovalTarget | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoScene, setDemoScene] = useState<string | null>(null);
  const [demoPlaying, setDemoPlaying] = useState(false);

  const openSheet = useCallback((t: TabId, opener = 'details') => {
    setTab(t);
    setOpenerId(opener);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setApproval(null);
  }, []);
  const startApproval = useCallback((target: ApprovalTarget, opener = 'approve') => {
    setApproval(target);
    setTab('messages');
    setOpenerId(opener);
    setSheetOpen(true);
  }, []);

  const value = useMemo<Ui>(
    () => ({
      sheetOpen,
      tab,
      openerId,
      approval,
      demoOpen,
      openSheet,
      closeSheet,
      setTab,
      setSheetOpen: (o) => (o ? setSheetOpen(true) : closeSheet()),
      startApproval,
      endApproval: () => setApproval(null),
      setDemoOpen,
      demoScene,
      demoPlaying,
      setDemoScene,
      setDemoPlaying,
    }),
    [sheetOpen, tab, openerId, approval, demoOpen, demoScene, demoPlaying, openSheet, closeSheet, startApproval],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
