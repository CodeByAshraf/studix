// src/modules/Placeholder.jsx
import { useUI }       from '../store/ui.context';
import { PageHeader, EmptyState } from '../components/shared';

export default function Placeholder({ title, icon = '🔧', description }) {
  const { navigate } = useUI();
  return (
    <div>
      <PageHeader title={title} subtitle={description}/>
      <div style={{ padding: '0 28px' }}>
        <div className="card">
          <EmptyState
            icon={icon}
            title={`وحدة ${title}`}
            subtitle="هذه الوحدة جاهزة للتطوير — البنية الكاملة متاحة في ملفات HTML"
            action={() => navigate('dashboard')}
            actionLabel="← لوحة التحكم"
          />
        </div>
      </div>
    </div>
  );
}
