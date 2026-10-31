import { type Card, SUIT_GLYPH, SUITS, RANKS, cardText, isRed, sameCard } from '../engine/cards';

export function PlayingCard({
  card,
  size = 'md',
  selected = false,
  dimmed = false,
  onClick,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`playing-card size-${size} ${isRed(card.suit) ? 'red' : 'black'} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      onClick={onClick}
      aria-label={`${card.rank} of ${suitName(card.suit)}`}
      aria-pressed={onClick ? selected : undefined}
    >
      <span className="corner">
        {card.rank}
        <i>{SUIT_GLYPH[card.suit]}</i>
      </span>
      <span className="pips">{SUIT_GLYPH[card.suit]}</span>
    </Tag>
  );
}

export function EmptySlot({ label }: { label: string }) {
  return <div className="empty-slot">{label}</div>;
}

export function CardPicker({
  selected,
  blocked,
  disabled,
  onToggle,
}: {
  selected: Card[];
  blocked: Card[];
  disabled?: boolean;
  onToggle: (card: Card) => void;
}) {
  return (
    <div className={`picker ${disabled ? 'is-disabled' : ''}`} aria-hidden={disabled}>
      {SUITS.map((suit) => (
        <div className="picker-row" key={suit}>
          <span className={`suit-label ${suit === 'h' || suit === 'd' ? 'red' : ''}`}>{SUIT_GLYPH[suit]}</span>
          {RANKS.map((rank) => {
            const card = { rank, suit };
            const key = cardText(card);
            const isSelected = selected.some((other) => sameCard(other, card));
            const isBlocked = blocked.some((other) => sameCard(other, card));
            return (
              <button
                key={key}
                type="button"
                className={`pip ${suit === 'h' || suit === 'd' ? 'red' : 'black'} ${isSelected ? 'on' : ''}`}
                disabled={disabled || isBlocked}
                onClick={() => onToggle(card)}
                aria-label={key}
              >
                {rank}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function suitName(suit: Card['suit']): string {
  if (suit === 's') return 'spades';
  if (suit === 'h') return 'hearts';
  if (suit === 'd') return 'diamonds';
  return 'clubs';
}
