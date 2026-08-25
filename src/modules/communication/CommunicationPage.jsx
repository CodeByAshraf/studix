// src/modules/communication/CommunicationPage.jsx
// ═══════════════════════════════════════════════════════════════════════════
// مركز التواصل (CRM) — شاشة واحدة، ثلاثة أعمدة:
// يسار: مركز التذكيرات | وسط: إنبوكس التواصل | يمين: ملف ولي الأمر.
// موديول مستقل — لا يعتمد على موديولات أخرى.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth } from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { useToast } from '../../components/Toast';
import { CommType, CommResult, CommStatus, TaskStatus } from './constants';
import {
  buildCommunication, buildFollowupTask, searchCommunications, nextCommNumber,
} from './communicationService';
import {
  deriveParents, getParentStats, getNextAction, getParentHistory, parentKey, normalizeParentPhone,
} from './parentService';
import { generateReminders, getInboxCounts } from './reminderService';
import { validateCommunication, hasErrors } from './validators';
import {
  pgCreateCommunication, pgCreateCommTask, pgGetCollection,
  pgCreateParent, pgUpdateParent, pgUpdateCommunication, pgUpdateCommTask,
} from '../../services/api';
import CommFormModal from './components/CommFormModal';
import ParentEditModal from './components/ParentEditModal';
import { CommRecordCard } from './components/parts';
import { InboxDashboard, ReminderCenter, ParentProfile } from './components/crmParts';

export default function CommunicationPage() {
  const toast = useToast();
  const { currentUser } = useAuth();
  const employee = currentUser?.name || currentUser?.id || 'الموظف الحالي';

  // ── الحالة من الـ store ──
  const records = useAppStore((s) => s.communications);
  const tasks   = useAppStore((s) => s.commTasks);
  const realParents = useAppStore((s) => s.parents);
  // MEDIUM-C (Finding 5): طلاب/قبولات مُزامَنة بالفعل — تُمرَّران لـ CommFormModal فقط
  // لبحث الربط الحقيقي (studentId/admissionId)؛ realParents (أعلاه) تُمرَّر أيضاً لحلّ
  // اسم ولي الأمر الحقيقي عند اختيار طالب له parentId. لا استيراد store داخل المودال
  // نفسه — يبقى مكوّناً عرضياً/testable بالكامل، بنفس أسلوبه الحالي.
  const students   = useAppStore((s) => s.students);
  const admissions = useAppStore((s) => s.admissions);
  const addCommunication  = useAppStore((s) => s.addCommunication);
  const addCommTask       = useAppStore((s) => s.addCommTask);
  const setParents         = useAppStore((s) => s.setParents);
  const updateCommunication = useAppStore((s) => s.updateCommunication);
  const updateCommTask      = useAppStore((s) => s.updateCommTask);

  // ── حالة الواجهة ──
  const [selectedParentKey, setSelectedParentKey] = useState(null);
  const [search, setSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState(null);
  const [showCommForm, setShowCommForm] = useState(false);
  const [showParentEdit, setShowParentEdit] = useState(false);
  const [savingParent, setSavingParent] = useState(false);

  // ── اشتقاق أولياء الأمور والتذكيرات والإنبوكس (كلها من الخدمات) ──
  const parents = useMemo(() => deriveParents(records, realParents), [records, realParents]);
  const reminders = useMemo(() => generateReminders(records, tasks), [records, tasks]);
  const inboxCounts = useMemo(() => getInboxCounts(records, tasks, { CommType }), [records, tasks]);

  // ── الإنبوكس: سجلات مفلترة حسب الفلتر النشط + البحث ──
  const inboxRecords = useMemo(() => {
    const active = records.filter((r) => r.status !== CommStatus.ARCHIVED);
    let list = active;
    const today = new Date().toISOString().split('T')[0];
    const dOnly = (d) => (d ? d.split('T')[0] : null);

    if (inboxFilter === 'dueToday' || inboxFilter === 'needsAction') {
      list = active.filter((r) => r.followupDate && dOnly(r.followupDate) <= today);
    } else if (inboxFilter === 'overdue') {
      list = active.filter((r) => r.followupDate && dOnly(r.followupDate) < today);
    } else if (inboxFilter === 'callsToday') {
      list = active.filter((r) => r.type === CommType.PHONE_CALL && dOnly(r.createdAt) === today);
    } else if (inboxFilter === 'whatsappToday') {
      list = active.filter((r) => r.type === CommType.WHATSAPP && dOnly(r.createdAt) === today);
    } else if (inboxFilter === 'completedToday') {
      list = active.filter((r) => r.status === CommStatus.COMPLETED && dOnly(r.updatedAt) === today);
    }

    list = searchCommunications(list, search);
    return list.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [records, inboxFilter, search]);

  // ── ولي الأمر المختار ──
  const selectedParent = parents.find((p) => p.key === selectedParentKey) || null;
  const parentHistory = useMemo(
    () => (selectedParentKey ? getParentHistory(records, selectedParentKey) : []),
    [records, selectedParentKey]
  );
  const parentStats = useMemo(
    () => (selectedParent ? getParentStats(parentHistory) : null),
    [selectedParent, parentHistory]
  );
  const nextAction = useMemo(
    () => (selectedParent ? getNextAction(parentHistory) : null),
    [selectedParent, parentHistory]
  );

  // ── حفظ سجل تواصل ──
  // Phase 3B-7: PostgreSQL هو مصدر الحقيقة الآن — لا تغيير محلي إلا بعد نجاح الخادم
  // (نفس نمط Exams/Homeworks). إنشاء التواصل ومهمة المتابعة عمليتان منفصلتان تماماً
  // (طلبان HTTP منفصلان، لا معاملة واحدة) — لو نجح التواصل وفشلت المهمة، يبقى التواصل
  // محفوظاً كما هو (communications محمي بـ prevent_delete() — لا آلية تراجع بالحذف).
  const handleSaveComm = async (data) => {
    const errors = validateCommunication({ ...data, employee });
    if (hasErrors(errors)) { toast.error(Object.values(errors)[0]); return; }

    const rec = buildCommunication({ ...data, employee }, records, employee);

    let saved;
    try {
      saved = await pgCreateCommunication(rec, {
        // إعادة المحاولة الوحيدة المسموحة: فقط عند تعارض number الفريد (409) —
        // تُحسب من أحدث حقيقة من الخادم، لا من القائمة المحلية المحتمل أنها قديمة.
        computeNextNumber: async () => {
          const fresh = await pgGetCollection('communications');
          return nextCommNumber(fresh);
        },
      });
    } catch (err) {
      toast.error(err.message || 'فشل حفظ سجل التواصل');
      return;
    }

    addCommunication(saved);
    toast.success(`تم تسجيل التواصل (${saved.number})`);
    setShowCommForm(false);
    setSelectedParentKey(parentKey(saved));

    if (data.followupDate) {
      const task = buildFollowupTask({
        commId: saved.id,
        title: `متابعة: ${saved.studentName || saved.parentName || saved.phone}`,
        dueDate: data.followupDate,
        dueTime: data.followupTime,
        priority: data.priority,
        employee,
      }, employee);

      try {
        const savedTask = await pgCreateCommTask(task);
        addCommTask(savedTask);
      } catch (err) {
        // لا نُلغي التواصل الناجح، ولا نُلفّق مهمة محلية — سجل التواصل يبقى كما أعاده
        // الخادم، والخطأ الحقيقي فقط يظهر للمستخدم.
        toast.error(err.message || 'تم حفظ سجل التواصل، لكن فشل إنشاء مهمة المتابعة');
      }
    }
  };

  // ── إكمال مهمة متابعة ──
  // Product Completion Phase 2 — Finding 3: نفس نمط handleSaveComm — لا تعديل محلي
  // إلا بعد رد الخادم، الحالة المحلية تُطابق استجابة الخادم حرفياً عند النجاح.
  const handleCompleteTask = async (task) => {
    try {
      const saved = await pgUpdateCommTask(task.id, { ...task, status: TaskStatus.COMPLETED });
      updateCommTask(task.id, saved);
      toast.success('تم إكمال المهمة ✓');
    } catch (err) {
      toast.error(err.message || 'فشل إكمال المهمة');
    }
  };

  // ── إكمال سجل تواصل ──
  const handleCompleteComm = async (record) => {
    try {
      const saved = await pgUpdateCommunication(record.id, { ...record, status: CommStatus.COMPLETED });
      updateCommunication(record.id, saved);
      toast.success('تم إكمال السجل ✓');
    } catch (err) {
      toast.error(err.message || 'فشل إكمال سجل التواصل');
    }
  };

  // ── حفظ بيانات ولي الأمر ──
  // Phase 3B-16: PostgreSQL (parents) هو مصدر الحقيقة الوحيد الآن — لا تعديل محلي
  // إلا بعد نجاح الخادم. الحماية الأساسية (لا مطابقة/إنشاء بالاسم إطلاقاً) موجودة في
  // ParentEditModal.jsx نفسه (زر الحفظ مُعطَّل بلا هاتف صالح) — الفحص هنا احترازي فقط.
  const handleSaveParent = async (data) => {
    const parent = selectedParent;
    if (!parent) return;
    setSavingParent(true);
    try {
      let saved;
      if (parent.id) {
        // صف parents حقيقي مطابَق بالفعل — تحديث مباشر، لا لمس للهاتف/الاسم إطلاقاً.
        saved = await pgUpdateParent(parent.id, data);
      } else {
        if (!parent.normalizedPhone) {
          toast.error('لا يمكن حفظ البيانات — لا يوجد رقم هاتف صالح لهذا السجل');
          return;
        }
        const result = await pgCreateParent(
          { phone: parent.normalizedPhone, fullName: parent.parentName || null, ...data },
          {
            // سباق نادر بين متصفّحين على نفس الهاتف — نفس نمط computeNextCode في
            // pgCreateMaterial بالضبط: جلب حقيقة طازجة من الخادم، لا من الحالة المحلية.
            onPhoneConflict: async () => {
              const fresh = await pgGetCollection('parents');
              return fresh.find((r) => normalizeParentPhone(r.phone) === parent.normalizedPhone)?.id ?? null;
            },
          }
        );
        if (result.conflict) {
          if (!result.existingId) throw new Error('تعذّر إيجاد سجل ولي الأمر بعد تعارض الهاتف');
          saved = await pgUpdateParent(result.existingId, data);
        } else {
          saved = result.data;
        }
      }
      setParents((prev) => {
        const exists = prev.some((p) => p.id === saved.id);
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
      });
      toast.success('تم حفظ بيانات ولي الأمر');
      setShowParentEdit(false);
    } catch (err) {
      toast.error(err.message || 'فشل حفظ بيانات ولي الأمر');
    } finally {
      setSavingParent(false);
    }
  };

  return (
    <SectionBoundary name="CommunicationPage">
      <div style={{ padding: 20, maxWidth: 1500, margin: '0 auto' }}>
        {/* العنوان */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>💬 مركز التواصل</h1>
            <p style={{ color: 'var(--text3)', fontSize: '0.85rem', margin: '4px 0 0' }}>
              نظام إدارة علاقات أولياء الأمور — تواصل ومتابعة وتذكيرات ذكية
            </p>
          </div>
          <button onClick={() => setShowCommForm(true)} style={primaryBtn}>+ تسجيل تواصل</button>
        </div>

        {/* لوحة الإنبوكس */}
        <InboxDashboard counts={inboxCounts} activeFilter={inboxFilter} onFilter={setInboxFilter} />

        {/* الجسم: 3 أعمدة */}
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 340px', gap: 14, marginTop: 16, alignItems: 'start' }}>

          {/* يسار: مركز التذكيرات */}
          <div style={panel}>
            <ReminderCenter reminders={reminders} onSelectParent={setSelectedParentKey} onCompleteTask={handleCompleteTask} />
          </div>

          {/* وسط: إنبوكس التواصل */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                إنبوكس التواصل ({inboxRecords.length})
                {inboxFilter && <button onClick={() => setInboxFilter(null)} style={{ marginRight: 8, fontSize: '0.68rem', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>إلغاء الفلتر ✕</button>}
              </span>
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم/الهاتف/الموظف/الرقم..." style={searchStyle} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, maxHeight: 600, overflowY: 'auto' }}>
              {inboxRecords.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.82rem', padding: 24 }}>
                  {records.length === 0 ? 'لا توجد سجلات — سجّل تواصلاً جديداً' : 'لا نتائج'}
                </div>
              ) : inboxRecords.map((r) => (
                <CommRecordCard
                  key={r.id}
                  record={r}
                  selected={selectedParentKey === parentKey(r)}
                  onClick={() => setSelectedParentKey(parentKey(r))}
                />
              ))}
            </div>
          </div>

          {/* يمين: ملف ولي الأمر */}
          <div style={panel}>
            <ParentProfile
              parent={selectedParent}
              stats={parentStats}
              nextAction={nextAction}
              history={parentHistory}
              onEdit={() => setShowParentEdit(true)}
              onCompleteRecord={handleCompleteComm}
            />
          </div>
        </div>
      </div>

      {/* المودالات */}
      {showCommForm && (
        <CommFormModal onClose={() => setShowCommForm(false)} onSave={handleSaveComm} students={students} admissions={admissions} parents={realParents} />
      )}
      {showParentEdit && selectedParent && (
        <ParentEditModal parent={selectedParent} onClose={() => setShowParentEdit(false)} onSave={handleSaveParent} loading={savingParent} />
      )}
    </SectionBoundary>
  );
}

const panel = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 };
const primaryBtn = { padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const searchStyle = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', fontSize: '0.82rem', direction: 'rtl' };
