// "Start here": a welcome dialog on first load. It offers the clocked counter
// demo or an empty bench, is remembered once dismissed, and comes back from
// the toolbar's "?" button.

import { markWelcomeSeen, welcomeSeen } from '../persistence/storage';

export interface WelcomeOptions {
  /** Load a demo by its DEMOS key. */
  readonly loadDemo: (key: string) => Promise<void>;
  /** Skip the automatic first-load showing (e.g. opening a shared link). */
  readonly suppress: boolean;
}

export function mountWelcome(
  dialog: HTMLDialogElement,
  help: HTMLButtonElement,
  { loadDemo, suppress }: WelcomeOptions,
): void {
  dialog.addEventListener('close', () => {
    markWelcomeSeen();
    const demo = dialog.returnValue;
    if (demo && demo !== 'build') void loadDemo(demo);
  });
  help.addEventListener('click', () => {
    dialog.returnValue = '';
    dialog.showModal();
  });
  if (!suppress && !welcomeSeen()) dialog.showModal();
}
