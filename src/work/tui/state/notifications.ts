// Notification Queue Management
// Handles notifications from background workers and user actions

import { Notification, NotificationType } from '../types.js';

// Generate unique ID
function generateId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class NotificationManager {
  private notifications: Map<string, Notification> = new Map();
  private maxNotifications: number = 50;

  add(params: {
    type: NotificationType;
    message: string;
    workstreamId?: string;
  }): Notification {
    const notification: Notification = {
      id: generateId(),
      type: params.type,
      message: params.message,
      workstreamId: params.workstreamId,
      timestamp: Date.now(),
      read: false,
    };

    this.notifications.set(notification.id, notification);
    
    // Prune old notifications if over limit
    if (this.notifications.size > this.maxNotifications) {
      this.pruneOld();
    }

    return notification;
  }

  markAsRead(id: string): void {
    const notification = this.notifications.get(id);
    if (notification) {
      notification.read = true;
    }
  }

  markAllAsRead(): void {
    for (const notification of this.notifications.values()) {
      notification.read = true;
    }
  }

  remove(id: string): boolean {
    return this.notifications.delete(id);
  }

  getNotification(id: string): Notification | undefined {
    return this.notifications.get(id);
  }

  getNotifications(): Notification[] {
    return Array.from(this.notifications.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getUnread(): Notification[] {
    return this.getNotifications().filter(n => !n.read);
  }

  getByWorkstream(workstreamId: string): Notification[] {
    return this.getNotifications().filter(n => n.workstreamId === workstreamId);
  }

  getByType(type: NotificationType): Notification[] {
    return this.getNotifications().filter(n => n.type === type);
  }

  clear(): void {
    this.notifications.clear();
  }

  clearRead(): void {
    for (const [id, notification] of this.notifications) {
      if (notification.read) {
        this.notifications.delete(id);
      }
    }
  }

  private pruneOld(): void {
    // Remove oldest read notifications first
    const sorted = this.getNotifications();
    const toRemove = sorted.length - this.maxNotifications;
    
    if (toRemove <= 0) return;
    
    // Sort by: read status (read first), then oldest first
    const candidates = sorted
      .sort((a, b) => {
        if (a.read !== b.read) return a.read ? -1 : 1;
        return a.timestamp - b.timestamp;
      })
      .slice(0, toRemove);
    
    for (const notification of candidates) {
      this.notifications.delete(notification.id);
    }
  }

  // Get count of unread by type (for badges/indicators)
  getUnreadCounts(): Record<NotificationType, number> {
    const counts: Record<NotificationType, number> = {
      pr_update: 0,
      agent_done: 0,
      agent_stuck: 0,
      agent_needs_input: 0,
      reminder: 0,
      info: 0,
      error: 0,
    };

    for (const notification of this.notifications.values()) {
      if (!notification.read) {
        counts[notification.type]++;
      }
    }

    return counts;
  }

  // Check if there are any urgent notifications
  hasUrgent(): boolean {
    return this.getUnread().some(n => 
      n.type === 'error' || 
      n.type === 'agent_stuck' || 
      n.type === 'agent_needs_input'
    );
  }
}



