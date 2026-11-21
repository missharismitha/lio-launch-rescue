import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type TabId = 'brief' | 'agent' | 'numbers' | 'messages' | 'offer' | 'health';
export type ApprovalTarget = 'supplier' | 'escalation';

interface Ui {
  sheetOpen: boolean;
  tab: TabId;
  openerId: string;
  approval: ApprovalTarget | null;
  demoOpen: boolean;
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

export function UiProvider({ children }: { children: ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('brief');
  const [openerId, setOpenerId] = useState('details');
  const [approval, setApproval] = useState<ApprovalTarget | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

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
    }),
    [sheetOpen, tab, openerId, approval, demoOpen, openSheet, closeSheet, startApproval],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
