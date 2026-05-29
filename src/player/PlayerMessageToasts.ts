/**
 * PlayerMessageToasts (v2.17 Player Voice) — stacked, dismissible toasts for
 * messages arriving at a player view (GM replies, or messages from other
 * players). They persist until the player dismisses them so a message during
 * a busy moment isn't missed. Appended to a fixed-position container.
 */

export interface IncomingMessage {
  messageId: string;
  fromName:  string;
  fromColor: string;
  text:      string;
}

export class PlayerMessageToasts {
  constructor(private container: HTMLElement) {}

  show(msg: IncomingMessage): void {
    const toast = document.createElement('div');
    toast.className = 'player-msg-toast';
    toast.style.setProperty('--from-color', msg.fromColor);

    const head = document.createElement('div');
    head.className = 'player-msg-toast-head';
    const who = document.createElement('span');
    who.className = 'player-msg-toast-from';
    who.textContent = msg.fromName;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'player-msg-toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    head.append(who, close);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'player-msg-toast-body';
    bodyEl.textContent = msg.text;

    toast.append(head, bodyEl);
    this.container.appendChild(toast);
  }
}
