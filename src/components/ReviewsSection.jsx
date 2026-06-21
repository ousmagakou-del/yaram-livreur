import { useState, useEffect, useRef } from 'react';
import { useUser } from '../App';
import { getProductReviews, createReview, uploadReviewPhoto, getReviewStats, markReviewHelpful } from '../lib/supabase';
import { toast } from '../lib/toast';
import './ReviewsSection.css';

export default function ReviewsSection({ productId }) {
  const { user } = useUser();
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ avg: 0, total: 0, distribution: [0,0,0,0,0] });
  const [showForm, setShowForm] = useState(false);
  const [photoFilter, setPhotoFilter] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [r, s] = await Promise.all([
          getProductReviews(productId),
          getReviewStats(productId),
        ]);
        if (cancelled) return;
        setReviews(r || []);
        setStats(s || { avg: 0, total: 0, distribution: [0,0,0,0,0] });
      } catch (e) {
        console.warn('[Reviews] fetch failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productId]);

  const refresh = async () => {
    // Refresh manuel (après submit review) — sans cancelled flag car appelé hors useEffect
    try {
      const [r, s] = await Promise.all([
        getProductReviews(productId),
        getReviewStats(productId),
      ]);
      setReviews(r || []);
      setStats(s || { avg: 0, total: 0, distribution: [0,0,0,0,0] });
    } catch (e) {
      console.warn('[Reviews] refresh failed:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data) => {
    const ok = await createReview({
      ...data,
      productId,
      userId: user.id,
      userName: user.first_name || 'Anonyme',
    });
    if (ok) {
      setShowForm(false);
      refresh();
    }
  };

  const displayed = photoFilter
    ? reviews.filter(r => r.photo_urls && r.photo_urls.length > 0)
    : reviews;

  if (loading) return null;

  return (
    <div className="rv-section">
      <div className="rv-header">
        <h2>⭐ Avis ({stats.total})</h2>
        {user && (
          <button className="rv-btn-primary" onClick={() => setShowForm(true)}>
            ✍️ Laisser un avis
          </button>
        )}
      </div>

      {/* Stats globales */}
      {stats.total > 0 && (
        <div className="rv-stats">
          <div className="rv-stats-left">
            <div className="rv-avg">{stats.avg.toFixed(1)}</div>
            <div className="rv-stars-big">
              {[1,2,3,4,5].map(i => (
                <span key={i}>{i <= Math.round(stats.avg) ? '⭐' : '☆'}</span>
              ))}
            </div>
            <div className="rv-total">{stats.total} avis</div>
          </div>
          <div className="rv-stats-right">
            {[5,4,3,2,1].map(star => {
              const count = stats.distribution[star - 1];
              const pct = stats.total ? (count / stats.total) * 100 : 0;
              return (
                <div key={star} className="rv-bar-row">
                  <span>{star}★</span>
                  <div className="rv-bar">
                    <div className="rv-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filtres */}
      {reviews.length > 0 && (
        <div className="rv-filters">
          <button
            className={`rv-filter ${!photoFilter ? 'active' : ''}`}
            onClick={() => setPhotoFilter(false)}
          >
            Tous ({reviews.length})
          </button>
          <button
            className={`rv-filter ${photoFilter ? 'active' : ''}`}
            onClick={() => setPhotoFilter(true)}
          >
            📸 Avec photos ({reviews.filter(r => r.photo_urls && r.photo_urls.length > 0).length})
          </button>
        </div>
      )}

      {/* Liste des avis */}
      {showForm && (
        <ReviewForm
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
        />
      )}

      {displayed.length === 0 && !showForm && (
        <div className="rv-empty">
          <p>Pas encore d'avis pour ce produit.</p>
          <p>Sois la première à donner ton avis !</p>
        </div>
      )}

      {displayed.map(r => (
        <ReviewCard key={r.id} review={r} onHelpful={() => markReviewHelpful(r.id).then(refresh)} />
      ))}
    </div>
  );
}

function ReviewCard({ review, onHelpful }) {
  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <div>
          <strong>{review.user_name || 'Anonyme'}</strong>
          {review.verified_purchase && (
            <span className="rv-verified">✓ Achat vérifié</span>
          )}
        </div>
        <span className="rv-date">
          {new Date(review.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
        </span>
      </div>
      
      <div className="rv-stars-row">
        {[1,2,3,4,5].map(i => (
          <span key={i}>{i <= review.rating ? '⭐' : '☆'}</span>
        ))}
        {review.title && <strong style={{ marginLeft: 8 }}>{review.title}</strong>}
      </div>
      
      {review.comment && <p className="rv-comment">{review.comment}</p>}
      
      {review.photo_urls && review.photo_urls.length > 0 && (
        <div className="rv-photos">
          {review.photo_urls.map((url, i) => (
            <img key={i} src={url} alt="" loading="lazy" decoding="async" />
          ))}
        </div>
      )}
      
      {review.pharmacy_response && (
        <div className="rv-response">
          <strong>💚 Réponse de la pharmacie</strong>
          <p>{review.pharmacy_response}</p>
        </div>
      )}
      
      <div className="rv-card-foot">
        <button onClick={onHelpful} className="rv-helpful">
          👍 Utile ({review.helpful_count || 0})
        </button>
      </div>
    </div>
  );
}

function ReviewForm({ onSubmit, onCancel }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (photos.length >= 3) {
      toast.error('Maximum 3 photos');
      return;
    }
    setUploading(true);
    const url = await uploadReviewPhoto(file);
    if (url) setPhotos([...photos, url]);
    setUploading(false);
  };

  const handleSubmit = () => {
    if (!comment.trim()) { toast.error('Ajoute un commentaire'); return; }
    onSubmit({ rating, title, comment, photoUrls: photos });
  };

  return (
    <div className="rv-form">
      <h3>Ton avis</h3>
      
      <label>Ta note</label>
      <div className="rv-rating-input">
        {[1,2,3,4,5].map(i => (
          <button
            key={i}
            type="button"
            onClick={() => setRating(i)}
            className={i <= rating ? 'active' : ''}
          >
            {i <= rating ? '⭐' : '☆'}
          </button>
        ))}
      </div>
      
      <label>Titre (optionnel)</label>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Ex: Super produit !"
      />
      
      <label>Ton expérience *</label>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Comment as-tu trouvé ce produit ? Ce qui t'a plu, déplu..."
        rows={4}
      />
      
      <label>Photos (max 3, optionnel)</label>
      <div className="rv-photos-input">
        {photos.map((url, i) => (
          <div key={i} className="rv-photo-preview">
            <img src={url} alt="" loading="lazy" decoding="async" />
            <button onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))}>✕</button>
          </div>
        ))}
        {photos.length < 3 && (
          <button
            type="button"
            className="rv-photo-add"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? '⏳' : '📷+'}
          </button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        onChange={handleFile}
        style={{ display: 'none' }}
      />
      
      <div className="rv-form-actions">
        <button className="rv-btn-secondary" onClick={onCancel}>Annuler</button>
        <button className="rv-btn-primary" onClick={handleSubmit}>📤 Publier</button>
      </div>
    </div>
  );
}
