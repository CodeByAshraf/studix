// src/App.jsx
// ─────────────────────────────────────────────────────────────────────────────
// React Router v6 Integration
//
// لماذا React Router؟
//   قبل: currentPage كـ state → لا يمكن مشاركة رابط لصفحة معينة
//              → زرار Back في المتصفح لا يعمل
//              → Bookmarking مستحيل
//   بعد: كل صفحة لها URL خاص → /students, /payments, /treasury
//              → Back/Forward يعمل بشكل طبيعي
//              → يمكن مشاركة الروابط
//
// استراتيجية التكامل مع UIContext:
//   UIContext لا يزال يحمل currentPage للـ Sidebar
//   لكن التنقل الحقيقي يتم عبر useNavigate من React Router
//   navigate() في UIContext يستدعي React Router navigate في نفس الوقت
// ─────────────────────────────────────────────────────────────────────────────
import { lazy, Suspense, useEffect }          from 'react';
import { BrowserRouter, Routes, Route,
         Navigate, useNavigate, useLocation } from 'react-router-dom';
import ErrorBoundary                          from './components/ErrorBoundary';
import { ToastProvider }                      from './components/Toast';
import AppLayout                              from './layouts/AppLayout';
import './styles/styles.css'; // ✅ STEP 8: static CSS file — browser-cacheable
import { ROUTES }                             from './constants/routes';
import { AuthProvider, useAuth }              from './store/auth.context';
import { UIProvider,   useUI   }              from './store/ui.context';
import { DataProvider }                       from './store/data.context';
import RouterNavigate                             from './components/RouterNavigate';
import { useDB, DBStatusBadge }                   from './hooks/useDB';

// ── Lazy imports ──────────────────────────────────────────────────────────────
// كل صفحة لها دالة تحميل منفصلة حتى نتمكن من الـ prefetch في الخلفية.
const loaders = {
  login:         () => import('./modules/LoginScreen'),
  dashboard:     () => import('./modules/Dashboard'),
  students:      () => import('./modules/students/StudentsPage'),
  admissions:    () => import('./modules/admissions/AdmissionsPage'),
  groups:        () => import('./modules/groups/GroupsPage'),
  attendance:    () => import('./modules/attendance/AttendancePage'),
  payments:      () => import('./modules/payments/PaymentsPage'),
  treasury:      () => import('./modules/treasury/TreasuryPage'),
  exams:         () => import('./modules/exams/ExamsPage'),
  homework:      () => import('./modules/homework/HomeworkPage'),
  materials:     () => import('./modules/materials/MaterialsPage'),
  inventory:     () => import('./modules/inventory/InventoryPage'),
  communication: () => import('./modules/communication/CommunicationPage'),
  users:         () => import('./modules/users/UsersPage'),
  studentReport: () => import('./modules/student-report/StudentReportPage'),
  reports:       () => import('./modules/reports/ReportsPage'),
  idCards:       () => import('./modules/id-cards/IDCardsPage'),
  notifications: () => import('./modules/notifications/NotificationsPage'),
  activityLog:   () => import('./modules/activity-log/ActivityLogPage'),
  settings:      () => import('./modules/settings/SettingsPage'),
};

// يُحمّل كل الصفحات في الخلفية بشكل تدريجي بعد جاهزية التطبيق، حتى يكون
// الانتقال بينها فورياً بلا انتظار تحميل الـ chunk عند أول فتح.
function prefetchAllPages() {
  const keys = Object.keys(loaders);
  let i = 0;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  const next = () => {
    if (i >= keys.length) return;
    loaders[keys[i++]]().catch(() => {});
    idle(next);
  };
  idle(next);
}

const LoginScreen       = lazy(loaders.login);
const Dashboard         = lazy(loaders.dashboard);
const StudentsPage      = lazy(loaders.students);
const AdmissionsPage    = lazy(loaders.admissions);
const GroupsPage        = lazy(loaders.groups);
const AttendancePage    = lazy(loaders.attendance);
const PaymentsPage      = lazy(loaders.payments);
const TreasuryPage      = lazy(loaders.treasury);
const ExamsPage         = lazy(loaders.exams);
const HomeworkPage      = lazy(loaders.homework);
const MaterialsPage     = lazy(loaders.materials);
const InventoryPage     = lazy(loaders.inventory);
const CommunicationPage = lazy(loaders.communication);
const UsersPage         = lazy(loaders.users);
const StudentReportPage = lazy(loaders.studentReport);
const ReportsPage       = lazy(loaders.reports);
const IDCardsPage       = lazy(loaders.idCards);
const NotificationsPage = lazy(loaders.notifications);
const ActivityLogPage   = lazy(loaders.activityLog);
const SettingsPage      = lazy(loaders.settings);

// ── Page Skeleton ─────────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div style={{ padding: 28 }}>
      <div className="skeleton" style={{ height: 28, width: 220, marginBottom: 8, borderRadius: 8 }}/>
      <div className="skeleton" style={{ height: 16, width: 160, marginBottom: 24, borderRadius: 6, opacity: .6 }}/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 14 }}/>)}
      </div>
      <div className="skeleton" style={{ height: 340, borderRadius: 14 }}/>
    </div>
  );
}

function PageShell({ children }) {
  return (
    <ErrorBoundary label="الصفحة">
      <Suspense fallback={<PageSkeleton/>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

// ── RouterSync ────────────────────────────────────────────────────────────────
// يُزامن React Router مع UIContext
// عندما يتغير الـ URL (Back/Forward)، يُحدّث currentPage في UIContext
// وعندما تُستدعى navigate() في UIContext، تُحدّث الـ URL أيضاً
function RouterSync() {
  const location   = useLocation();
  const rrNavigate = useNavigate();
  const { navigate: uiNavigate } = useUI();

  // مزامنة URL → UIContext عند Back/Forward
  const pathToRoute = location.pathname.replace('/', '') || ROUTES.DASHBOARD;

  // UIContext's navigate now also pushes to browser history
  // This is handled via the enhanced UIProvider below

  return null;
}

// ── Protected Routes ──────────────────────────────────────────────────────────
// كل صفحة داخل التطبيق تمر عبر هذا الـ wrapper
// إذا لم يكن المستخدم مسجلاً يُعاد توجيهه لـ /login
function ProtectedRoute({ children, pageId }) {
  const { isLoggedIn, canAccess } = useAuth();
  const location = useLocation();

  if (!isLoggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (pageId && !canAccess(pageId)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// ── AppRoutes — جميع الصفحات بـ URLs حقيقية ──────────────────────────────────
function AppRoutes() {
  const { isLoggedIn } = useAuth();

  return (
    <>
    <RouterNavigate/>
    <Routes>
      {/* Login */}
      <Route path="/login" element={
        isLoggedIn
          ? <Navigate to="/" replace />
          : (
            <ErrorBoundary label="شاشة الدخول">
              <Suspense fallback={
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                  height:'100vh', background:'#0a1628', color:'#4a9994',
                  fontSize:16, fontFamily:'Cairo,sans-serif' }}>
                  ⏳ جاري التحميل...
                </div>
              }>
                <LoginRouteWrapper/>
              </Suspense>
            </ErrorBoundary>
          )
      }/>

      {/* Protected app routes */}
      <Route path="/" element={
        <ProtectedRoute>
          <AppLayout/>
        </ProtectedRoute>
      }>
        <Route index                          element={<ProtectedRoute pageId="dashboard"><PageShell><Dashboard/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.DASHBOARD}        element={<ProtectedRoute pageId="dashboard"><PageShell><Dashboard/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.STUDENTS}         element={<ProtectedRoute pageId="students"><PageShell><StudentsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.ADMISSIONS}       element={<ProtectedRoute pageId="admissions"><PageShell><AdmissionsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.GROUPS}           element={<ProtectedRoute pageId="groups"><PageShell><GroupsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.ATTENDANCE}       element={<ProtectedRoute pageId="attendance"><PageShell><AttendancePage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.PAYMENTS}         element={<ProtectedRoute pageId="payments"><PageShell><PaymentsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.TREASURY}         element={<ProtectedRoute pageId="treasury"><PageShell><TreasuryPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.EXAMS}            element={<ProtectedRoute pageId="exams"><PageShell><ExamsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.HOMEWORK}         element={<ProtectedRoute pageId="homework"><PageShell><HomeworkPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.MATERIALS}        element={<ProtectedRoute pageId="materials"><PageShell><MaterialsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.INVENTORY}        element={<ProtectedRoute pageId="materials"><PageShell><InventoryPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.COMMUNICATION}    element={<ProtectedRoute pageId="students"><PageShell><CommunicationPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.USERS}            element={<ProtectedRoute pageId="users"><PageShell><UsersPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.STUDENT_REPORT}   element={<ProtectedRoute pageId="students"><PageShell><StudentReportPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.REPORTS}          element={<ProtectedRoute pageId="reports"><PageShell><ReportsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.ID_CARDS}         element={<ProtectedRoute pageId="id-cards"><PageShell><IDCardsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.NOTIFICATIONS}    element={<ProtectedRoute pageId="notifications"><PageShell><NotificationsPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.ACTIVITY_LOG}     element={<ProtectedRoute pageId="activity-log"><PageShell><ActivityLogPage/></PageShell></ProtectedRoute>}/>
        <Route path={ROUTES.SETTINGS}         element={<ProtectedRoute pageId="settings"><PageShell><SettingsPage/></PageShell></ProtectedRoute>}/>
        {/* 404 inside app */}
        <Route path="*" element={<Navigate to="/" replace />}/>
      </Route>

      {/* 404 outside app */}
      <Route path="*" element={<Navigate to="/login" replace />}/>
    </Routes>
    </>
  );
}

// ── LoginRouteWrapper ─────────────────────────────────────────────────────────
function LoginRouteWrapper() {
  const { login } = useAuth();
  return <LoginScreen onLogin={login}/>;
}

// ── UINavigationSync ──────────────────────────────────────────────────────────
// يُزامن UIContext navigate مع React Router
// المكونات القديمة تستدعي navigate('students') → يُحوَّل لـ /students
function UINavigationSync() {
  const rrNavigate = useNavigate();
  const location   = useLocation();
  const { navigate: uiNavigate, currentPage } = useUI();

  // مزامنة URL → UIContext: عند Back/Forward يُحدَّث currentPage
  const pathSegment = location.pathname.replace('/', '') || ROUTES.DASHBOARD;

  // لا نحتاج useEffect هنا لأن UIContext يقرأ currentPage مباشرة من الـ switch في AppRoutes
  // لكن نُزوّد navigate() في UIContext بـ React Router navigate
  // هذا يتم عبر UIProvider الذي يستقبل onNavigate prop

  return null;
}

// ── AuthConsumerForUI ─────────────────────────────────────────────────────────
function AuthConsumerForUI({ children }) {
  const { canAccess } = useAuth();
  return children(canAccess);
}


// ── DB Initializer — يحمّل البيانات من PostgreSQL عند الفتح ───────────────
function DBInit({ children }) {
  const dbStatus = useDB();
  // بعد جاهزية التطبيق، حمّل باقي الصفحات في الخلفية ليكون التنقّل فورياً.
  useEffect(() => { prefetchAllPages(); }, []);
  return (
    <>
      {children}
      {/* DB status badge — bottom-left corner */}
      <div style={{ position:'fixed', bottom:12, left:12, zIndex:9999 }} className="no-print">
        <DBStatusBadge status={dbStatus}/>
      </div>
    </>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthConsumerForUI>
          {(canAccess) => (
            <UIProvider canAccess={canAccess}>
              <DataProvider>
                <ToastProvider>
                  <DBInit><AppRoutes/></DBInit>
                </ToastProvider>
              </DataProvider>
            </UIProvider>
          )}
        </AuthConsumerForUI>
      </AuthProvider>
    </BrowserRouter>
  );
}
