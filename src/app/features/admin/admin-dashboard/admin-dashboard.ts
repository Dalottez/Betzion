import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import {
  AdminHistoryRow,
  AdminParticipant,
  AdminSocketService
} from '../../../core/services/admin-socket.service';
import { AuthService } from '../../../core/services/auth.service';
import { API_ORIGIN } from '../../../core/config/api-url';

export interface AdminUser {
  id: number;
  username: string;
  phone_number?: string;
  balance: number;
  role: string;
  is_suspended: boolean;
  created_at: string;
}

export interface AdminTransaction {
  id: number;
  user_id: number;
  username: string;
  phone_number?: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  status: 'completed' | 'failed' | 'pending';
  reference?: string;
  created_at: string;
}

export interface AdminLog {
  id: number;
  action: string;
  details: string;
  admin_username: string;
  created_at: string;
}

export interface ActiveUser {
  id: number;
  username: string;
  phone_number?: string;
  balance: number;
  role: string;
  is_suspended: boolean;
  total_deposits: number;
  total_wagers: number;
  is_online: boolean;
  created_at: string;
}

export interface PendingWithdrawal {
  id: number;
  user_id: number;
  username: string;
  phone_number?: string;
  user_current_balance: number;
  amount: number;
  payment_method: string;
  account_details: string;
  status: string;
  user_total_deposits: number;
  user_total_wagers: number;
  is_online: boolean;
  created_at: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css'
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  private adminSocket = inject(AdminSocketService);
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private router = inject(Router);

  public activeTab: 'monitor' | 'withdrawal-settings' | 'active-users' | 'transactions' | 'users' | 'admins' | 'logs' = 'monitor';
  public mobileMenuOpen: boolean = false;

  public nextRound$ = this.adminSocket.nextRound$;
  public previousRound$ = this.adminSocket.previousRound$;
  public currentRound$ = this.adminSocket.currentRound$;
  public history$ = this.adminSocket.history$;
  public isConnected$ = this.adminSocket.isConnected$;
  public error$ = this.adminSocket.error$;

  // Overview Stats
  public stats = {
    totalUsers: 0,
    totalBets: 0,
    totalVolume: 0,
    totalPayout: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    connectedPlayers: 0,
    onlineUsers: 0
  };

  // Active Users & Withdrawal Wager State
  public activeUsersList: ActiveUser[] = [];
  public pendingWithdrawalsList: PendingWithdrawal[] = [];
  public isLoadingActiveUsers: boolean = false;
  public withdrawalWagerRequirement: number = 2500;
  public withdrawalInitiationTitle: string = 'Withdrawal Notice';
  public withdrawalInitiationMessage: string = 'Your withdrawal request has been received and is awaiting review.';
  public isSavingWithdrawalWagerRequirement: boolean = false;

  // Custom Notification Modal State
  public showNotifyModal: boolean = false;
  public selectedUserForNotif: ActiveUser | PendingWithdrawal | null = null;
  public selectedWithdrawalId: number | null = null;
  public notifActionType: 'complete' | 'reject' | 'custom' = 'complete';
  public notifTitle: string = '';
  public notifMessage: string = '';
  public isSendingNotif: boolean = false;

  // Transactions State
  public transactionsList: AdminTransaction[] = [];
  public txTypeFilter: 'deposit' | 'withdrawal' = 'deposit';
  public txSearchQuery: string = '';
  public txStatusFilter: string = 'all';
  public isLoadingTransactions: boolean = false;
  private transactionRequestVersion = 0;
  private realtimeSubscriptions: Subscription[] = [];
  private realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRealtimeRefresh = {
    dashboard: false,
    transactions: false,
    users: false,
    admins: false,
    activeUsers: false,
    logs: false,
    withdrawalSettings: false
  };

  // User Management State
  public userList: AdminUser[] = [];
  public searchQuery: string = '';
  public roleFilter: string = 'all';
  public isLoadingUsers: boolean = false;

  // Admins List & New Admin Form State
  public adminsList: AdminUser[] = [];
  public isLoadingAdmins: boolean = false;
  public showCreateAdminModal: boolean = false;
  public newAdminUsername: string = '';
  public newAdminPhone: string = '';
  public newAdminPassword: string = '';

  // Role change loading state (per user id)
  public isSettingRole: number | null = null;

  // Admin Logs State
  public adminLogs: AdminLog[] = [];

  /** True for superadmin — used to show/hide the Admins tab */
  public get isSuperAdmin(): boolean {
    const role = this.authService.currentUser$.getValue()?.role;
    return role === 'superadmin';
  }

  public ngOnInit(): void {
    const token = this.authService.getToken();
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    // The adminGuard already verified admin/superadmin role before this component loads.
    // We only redirect if the user is explicitly set to a non-admin role (not null/loading).
    const user = this.authService.currentUser$.getValue();
    if (user && user.role !== 'admin' && user.role !== 'superadmin') {
      this.router.navigate(['/play']);
      return;
    }

    this.adminSocket.connect(token);
    this.fetchOverviewStats();
    this.fetchTransactions();
    this.fetchUsers();
    if (this.isSuperAdmin) this.fetchAdmins();
    this.fetchLogs();
    this.fetchWithdrawalSettings();
    this.subscribeToRealtimeUpdates();
  }


  public ngOnDestroy(): void {
    this.realtimeSubscriptions.forEach(subscription => subscription.unsubscribe());
    if (this.realtimeRefreshTimer !== null) clearTimeout(this.realtimeRefreshTimer);
    this.adminSocket.disconnect();
  }

  private subscribeToRealtimeUpdates(): void {
    this.realtimeSubscriptions.push(
      this.adminSocket.transactionUpdate$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ transactions: true, dashboard: true, activeUsers: true, logs: true });
      }),
      this.adminSocket.dashboardStatsUpdated$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ dashboard: true });
      }),
      this.adminSocket.walletUpdated$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ dashboard: true, users: true, activeUsers: true });
      }),
      this.adminSocket.transactionsUpdated$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ transactions: true, dashboard: true, activeUsers: true });
      }),
      this.adminSocket.depositsUpdated$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ transactions: true, dashboard: true, activeUsers: true });
      }),
      this.adminSocket.withdrawalsUpdated$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ transactions: true, dashboard: true, activeUsers: true });
      }),
      this.adminSocket.userUpdated$.subscribe(event => {
        if (event) this.queueRealtimeRefresh({ users: true, admins: this.isSuperAdmin, activeUsers: true, dashboard: true });
      }),
      this.adminSocket.activityUpdated$.subscribe(event => {
        if (!event) return;
        this.queueRealtimeRefresh({
          logs: true,
          withdrawalSettings: event.action === 'withdrawal_settings_updated'
        });
      })
    );
  }

  private queueRealtimeRefresh(refresh: Partial<typeof this.pendingRealtimeRefresh>): void {
    Object.assign(this.pendingRealtimeRefresh, refresh);
    if (this.realtimeRefreshTimer !== null) return;

    // A single money mutation emits a few intentionally specific events. Batch
    // that burst into one refresh per data set, while still updating on the
    // same event loop turn and never requiring a page reload.
    this.realtimeRefreshTimer = setTimeout(() => {
      const requested = { ...this.pendingRealtimeRefresh };
      Object.keys(this.pendingRealtimeRefresh).forEach(key => {
        this.pendingRealtimeRefresh[key as keyof typeof this.pendingRealtimeRefresh] = false;
      });
      this.realtimeRefreshTimer = null;

      console.log(`[${new Date().toISOString()}] [PAYMENT_LOG] Admin UI updated`, requested);
      if (requested.dashboard) this.fetchOverviewStats();
      if (requested.transactions) this.fetchTransactions();
      if (requested.users) this.fetchUsers();
      if (requested.admins && this.isSuperAdmin) this.fetchAdmins();
      if (requested.activeUsers && this.activeTab === 'active-users') this.fetchActiveUsers();
      if (requested.logs) this.fetchLogs();
      if (requested.withdrawalSettings && this.activeTab === 'withdrawal-settings') this.fetchWithdrawalSettings();
    }, 0);
  }

  public toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  public setTab(tab: 'monitor' | 'withdrawal-settings' | 'active-users' | 'transactions' | 'users' | 'admins' | 'logs'): void {
    // Admins tab is superadmin-only
    if (tab === 'admins' && !this.isSuperAdmin) return;
    this.activeTab = tab;
    this.mobileMenuOpen = false;
    if (tab === 'monitor') this.fetchOverviewStats();
    if (tab === 'withdrawal-settings') this.fetchWithdrawalSettings();
    if (tab === 'active-users') {
      this.fetchActiveUsers();
      this.fetchWithdrawalSettings();
    }
    if (tab === 'transactions') this.fetchTransactions();
    if (tab === 'users') this.fetchUsers();
    if (tab === 'admins') this.fetchAdmins();
    if (tab === 'logs') this.fetchLogs();
  }

  private get baseUrl(): string {
    return API_ORIGIN;
  }

  public fetchActiveUsers(): void {
    const token = this.authService.getToken();
    if (!token) return;

    this.isLoadingActiveUsers = true;
    this.http.get<{ activeUsers: ActiveUser[]; pendingWithdrawals: PendingWithdrawal[] }>(
      `${this.baseUrl}/api/admin/active-users`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.activeUsersList = res.activeUsers || [];
        this.pendingWithdrawalsList = res.pendingWithdrawals || [];
        this.isLoadingActiveUsers = false;
      },
      error: () => {
        this.isLoadingActiveUsers = false;
      }
    });
  }

  public fetchWithdrawalSettings(): void {
    const token = this.authService.getToken();
    if (!token) return;

    this.http.get<{ minimum_total_wager: number; initiation_title: string; initiation_message: string }>(
      `${this.baseUrl}/api/admin/withdrawal-settings`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.withdrawalWagerRequirement = Number(res.minimum_total_wager) || 0;
        this.withdrawalInitiationTitle = res.initiation_title || this.withdrawalInitiationTitle;
        this.withdrawalInitiationMessage = res.initiation_message || this.withdrawalInitiationMessage;
      }
    });
  }

  public saveWithdrawalWagerRequirement(): void {
    const minimumTotalWager = Number(this.withdrawalWagerRequirement);
    if (!Number.isFinite(minimumTotalWager) || minimumTotalWager < 0) {
      alert('Enter a wager requirement of zero or more.');
      return;
    }
    if (!this.withdrawalInitiationTitle.trim() || !this.withdrawalInitiationMessage.trim()) {
      alert('Enter both a popup title and a popup message.');
      return;
    }

    const token = this.authService.getToken();
    if (!token) return;

    this.isSavingWithdrawalWagerRequirement = true;
    this.http.put<{ minimum_total_wager: number; initiation_title: string; initiation_message: string }>(
      `${this.baseUrl}/api/admin/withdrawal-settings`,
      {
        minimum_total_wager: minimumTotalWager,
        initiation_title: this.withdrawalInitiationTitle,
        initiation_message: this.withdrawalInitiationMessage
      },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.withdrawalWagerRequirement = Number(res.minimum_total_wager);
        this.withdrawalInitiationTitle = res.initiation_title;
        this.withdrawalInitiationMessage = res.initiation_message;
        this.isSavingWithdrawalWagerRequirement = false;
        alert('Withdrawal settings and popup template saved.');
      },
      error: (err) => {
        this.isSavingWithdrawalWagerRequirement = false;
        alert(err?.error?.error || 'Failed to save withdrawal wager requirement.');
      }
    });
  }

  public openWithdrawalModal(wd: PendingWithdrawal, action: 'complete' | 'reject'): void {
    const actionLabel = action === 'complete' ? 'complete' : 'reject';
    if (!confirm(`Are you sure you want to ${actionLabel} withdrawal #${wd.id}?`)) return;
    this.processWithdrawal(wd.id, action);
  }

  private processWithdrawal(withdrawalId: number, action: 'complete' | 'reject'): void {
    const token = this.authService.getToken();
    if (!token || this.isSendingNotif) return;

    this.isSendingNotif = true;
    this.http.post<{ message: string; status: string }>(
      `${this.baseUrl}/api/admin/withdrawals/process`,
      { withdrawal_id: withdrawalId, action },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        this.isSendingNotif = false;
        alert(res.message);
        this.fetchActiveUsers();
        this.fetchOverviewStats();
        this.fetchLogs();
      },
      error: (err) => {
        this.isSendingNotif = false;
        alert(err?.error?.error || 'Failed to process withdrawal.');
      }
    });
  }

  public openDirectNotifModal(user: ActiveUser): void {
    this.selectedUserForNotif = user;
    this.selectedWithdrawalId = null;
    this.notifActionType = 'custom';
    this.notifTitle = '📢 Administrator Message';
    this.notifMessage = `Hello ${user.username}, `;
    this.showNotifyModal = true;
  }

  public closeNotifyModal(): void {
    this.showNotifyModal = false;
    this.selectedUserForNotif = null;
    this.selectedWithdrawalId = null;
    this.notifTitle = '';
    this.notifMessage = '';
  }

  public submitNotificationAction(): void {
    if (!this.selectedUserForNotif || !this.notifMessage.trim()) {
      alert('Please enter a message to send.');
      return;
    }

    const token = this.authService.getToken();
    if (!token) return;

    this.isSendingNotif = true;

    if (this.selectedWithdrawalId !== null && (this.notifActionType === 'complete' || this.notifActionType === 'reject')) {
      // Process Pending Withdrawal
      this.http.post<{ message: string; status: string }>(
        `${this.baseUrl}/api/admin/withdrawals/process`,
        {
          withdrawal_id: this.selectedWithdrawalId,
          action: this.notifActionType,
          custom_title: this.notifTitle,
          custom_message: this.notifMessage
        },
        { headers: { Authorization: `Bearer ${token}` } }
      ).subscribe({
        next: (res) => {
          this.isSendingNotif = false;
          alert(`✅ ${res.message}! Pop-up notification sent to player.`);
          this.closeNotifyModal();
          this.fetchActiveUsers();
          this.fetchOverviewStats();
          this.fetchLogs();
        },
        error: (err) => {
          this.isSendingNotif = false;
          alert(err?.error?.error || 'Failed to process withdrawal.');
        }
      });
    } else {
      // Send Direct Custom Pop-Up Notification to Active Player
      const targetUserId = 'user_id' in this.selectedUserForNotif
        ? this.selectedUserForNotif.user_id
        : this.selectedUserForNotif.id;

      this.http.post<{ message: string }>(
        `${this.baseUrl}/api/admin/notifications/send`,
        {
          target_user_id: targetUserId,
          title: this.notifTitle,
          message: this.notifMessage
        },
        { headers: { Authorization: `Bearer ${token}` } }
      ).subscribe({
        next: (res) => {
          this.isSendingNotif = false;
          alert('✅ Notification popped up live on player phone/screen!');
          this.closeNotifyModal();
          this.fetchLogs();
        },
        error: (err) => {
          this.isSendingNotif = false;
          alert(err?.error?.error || 'Failed to send notification.');
        }
      });
    }
  }

  public fetchOverviewStats(): void {
    const token = this.authService.getToken();
    if (!token) return;

    this.http.get<any>(`${this.baseUrl}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: (res) => {
        this.stats = { ...this.stats, ...res };
      }
    });
  }

  public fetchTransactions(): void {
    const token = this.authService.getToken();
    if (!token) return;

    // A user can switch between Deposits and Withdrawals before an earlier
    // request finishes. Keep an older response from replacing the rows for
    // the tab that is currently selected.
    const requestVersion = ++this.transactionRequestVersion;
    const requestedType = this.txTypeFilter;
    this.isLoadingTransactions = true;
    const url = `${this.baseUrl}/api/admin/transactions?type=${requestedType}&search=${encodeURIComponent(this.txSearchQuery)}&status=${this.txStatusFilter}`;
    this.http.get<{ transactions: AdminTransaction[] }>(url, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: (res) => {
        if (requestVersion !== this.transactionRequestVersion || requestedType !== this.txTypeFilter) return;
        // Defensive filtering also ensures a tab never renders a row from the
        // other transaction type if an unexpected response is received.
        this.transactionsList = (res.transactions || []).filter(tx => tx.type === requestedType);
        this.isLoadingTransactions = false;
      },
      error: () => {
        if (requestVersion !== this.transactionRequestVersion || requestedType !== this.txTypeFilter) return;
        this.isLoadingTransactions = false;
      }
    });
  }

  public setTransactionType(type: 'deposit' | 'withdrawal'): void {
    if (this.txTypeFilter === type) return;
    this.txTypeFilter = type;
    this.fetchTransactions();
  }

  public fetchUsers(): void {
    const token = this.authService.getToken();
    if (!token) return;

    this.isLoadingUsers = true;
    const url = `${this.baseUrl}/api/admin/users?search=${encodeURIComponent(this.searchQuery)}&role=${this.roleFilter}`;
    this.http.get<{ users: AdminUser[] }>(url, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: (res) => {
        this.userList = res.users;
        this.isLoadingUsers = false;
      },
      error: () => {
        this.isLoadingUsers = false;
      }
    });
  }

  public fetchAdmins(): void {
    const token = this.authService.getToken();
    if (!token) return;

    this.isLoadingAdmins = true;
    this.http.get<{ admins: AdminUser[] }>(`${this.baseUrl}/api/admin/admins`, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: (res) => {
        this.adminsList = res.admins;
        this.isLoadingAdmins = false;
      },
      error: () => {
        this.isLoadingAdmins = false;
      }
    });
  }

  public createAdmin(): void {
    if (!this.newAdminUsername || !this.newAdminPassword || this.newAdminPassword.length < 6) {
      alert('Please provide a valid username and password (min 6 characters).');
      return;
    }

    const token = this.authService.getToken();
    if (!token) return;

    this.http.post<{ message: string }>(
      `${this.baseUrl}/api/admin/create-admin`,
      { username: this.newAdminUsername, phone_number: this.newAdminPhone, password: this.newAdminPassword },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        alert(res.message);
        this.showCreateAdminModal = false;
        this.newAdminUsername = '';
        this.newAdminPhone = '';
        this.newAdminPassword = '';
        this.fetchAdmins();
        this.fetchLogs();
      },
      error: (err) => {
        alert(err?.error?.error || 'Failed to create admin');
      }
    });
  }

  public toggleSuspend(user: AdminUser): void {
    const token = this.authService.getToken();
    if (!token) return;

    const action = user.is_suspended ? 'activate' : 'suspend';
    if (!confirm(`Are you sure you want to ${action} user "${user.username}"?`)) return;

    this.http.post(
      `${this.baseUrl}/api/admin/users/${user.id}/suspend`,
      { suspend: !user.is_suspended },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: () => {
        user.is_suspended = !user.is_suspended;
        this.fetchLogs();
      }
    });
  }

  public adjustBalance(user: AdminUser): void {
    const amountStr = prompt(`Enter amount to adjust for ${user.username} (e.g. 500 or -200):`);
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) return;

    const token = this.authService.getToken();
    this.http.post<{ newBalance: number }>(
      `${this.baseUrl}/api/admin/users/${user.id}/balance`,
      { amount },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: (res) => {
        user.balance = res.newBalance;
        this.fetchLogs();
      }
    });
  }

  public resetPassword(user: AdminUser): void {
    const newPass = prompt(`Enter new password for user ${user.username} (min 6 chars):`);
    if (!newPass || newPass.length < 6) return;

    const token = this.authService.getToken();
    this.http.post(
      `${this.baseUrl}/api/admin/users/${user.id}/reset-password`,
      { newPassword: newPass },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: () => {
        alert(`Password reset successfully for ${user.username}`);
        this.fetchLogs();
      }
    });
  }

  public deleteUser(user: AdminUser): void {
    if (!confirm(`CAUTION: Permanently delete user "${user.username}"?`)) return;

    const token = this.authService.getToken();
    this.http.delete(`${this.baseUrl}/api/admin/users/${user.id}`, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: () => {
        this.fetchUsers();
        this.fetchLogs();
      },
      error: (err) => {
        alert(err?.error?.error || 'Failed to delete user.');
      }
    });
  }

  /** Superadmin only — promote or demote a user's role */
  public setUserRole(user: AdminUser, role: 'user' | 'admin'): void {
    if (!this.isSuperAdmin) return;
    if (!confirm(`Change role of "${user.username}" to "${role}"?`)) return;

    const token = this.authService.getToken();
    this.isSettingRole = user.id;
    this.http.post<{ message: string }>(
      `${this.baseUrl}/api/admin/users/${user.id}/set-role`,
      { role },
      { headers: { Authorization: `Bearer ${token}` } }
    ).subscribe({
      next: () => {
        user.role = role;
        this.isSettingRole = null;
        this.fetchLogs();
      },
      error: (err) => {
        this.isSettingRole = null;
        alert(err?.error?.error || 'Failed to update role.');
      }
    });
  }

  /** Superadmin only — remove an admin account */
  public deleteAdmin(admin: AdminUser): void {
    if (!this.isSuperAdmin) return;
    if (!confirm(`Remove admin privileges from "${admin.username}"? This will delete the account.`)) return;

    const token = this.authService.getToken();
    this.http.delete(`${this.baseUrl}/api/admin/users/${admin.id}`, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: () => {
        this.adminsList = this.adminsList.filter(a => a.id !== admin.id);
        this.fetchLogs();
      },
      error: (err) => {
        alert(err?.error?.error || 'Failed to remove admin.');
      }
    });
  }

  public exportUsersCSV(): void {
    if (this.userList.length === 0) return;
    const headers = ['ID', 'Username', 'Phone', 'Role', 'Balance', 'Status', 'Created At'];
    const rows = this.userList.map(u => [
      u.id,
      `"${u.username}"`,
      `"${u.phone_number || ''}"`,
      u.role,
      u.balance,
      u.is_suspended ? 'Suspended' : 'Active',
      `"${u.created_at}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `users_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  public fetchLogs(): void {
    const token = this.authService.getToken();
    if (!token) return;

    this.http.get<{ logs: AdminLog[] }>(`${this.baseUrl}/api/admin/logs`, { headers: { Authorization: `Bearer ${token}` } }).subscribe({
      next: (res) => {
        this.adminLogs = res.logs;
      }
    });
  }


  public formatCountdown(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${seconds}s`;
  }

  public formatMultiplier(value: number | null): string {
    return value === null ? '--' : `${value.toFixed(2)}x`;
  }

  public backToGame(): void {
    this.router.navigate(['/play']);
  }


  public logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
