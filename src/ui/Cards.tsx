import { useEffect } from 'react';
import { type Card, RANK_WORD, SUIT_GLYPH, SUITS, isRed } from '../engine/cards';
import {
  type PickerSession,
  type SlotId,
  PICKER_RANKS,
  rankBlocked,
  rankLabel,
  slotHeading,
  suitBlocked,
  suitName,
} from './cardPicker';

export function PlayingCard({
  card,
  size = 'md',
  selected = false,
  dimmed = false,
  onClick,
  testId,
  label,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  testId?: string;
  label?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`playing-card size-${size} ${isRed(card.suit) ? 'red' : 'black'} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      onClick={onClick}
      data-testid={testId}
      aria-label={label ?? `${rankLabel(card.rank)} of ${suitName(card.suit)}`}
      aria-pressed={onClick ? selected : undefined}
    >
      <span className="corner">
        {rankLabel(card.rank)}
        <i>{SUIT_GLYPH[card.suit]}</i>
      </span>
      <span className="pips">{SUIT_GLYPH[card.suit]}</span>
    </Tag>
  );
}

export function CardSlot({
  slot,
  label,
  card,
  active,
  disabled = false,
  lockReason,
  onClick,
}: {
  slot: SlotId;
  label: string;
  card: Card | null;
  active: boolean;
  disabled?: boolean;
  lockReason?: string | null;
  onClick: () => void;
}) {
  if (card) {
    return (
      <PlayingCard
        card={card}
        size="lg"
        selected={active}
        onClick={onClick}
        testId={`slot-${slot}`}
        label={`${slotHeading(slot)}, ${rankLabel(card.rank)} of ${suitName(card.suit)}. Change this card`}
      />
    );
  }
  return (
    <button
      type="button"
      className={`empty-slot${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      data-testid={`slot-${slot}`}
      aria-pressed={active}
      title={lockReason ?? undefined}
      aria-label={
        disabled
          ? `${slotHeading(slot)} unavailable. ${lockReason ?? ''}`.trim()
          : `${slotHeading(slot)}, empty. Choose a card`
      }
    >
      {label}
    </button>
  );
}

export function RankSuitPicker({
  session,
  taken,
  current,
  onRank,
  onSuit,
  onBack,
  onClear,
}: {
  session: PickerSession;
  taken: Card[];
  current: Card | null;
  onRank: (rank: Card['rank']) => void;
  onSuit: (suit: Card['suit']) => void;
  onBack: () => void;
  onClear: () => void;
}) {
  useEffect(() => {
    document.getElementById('card-picker')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [session.slot, session.step]);

  const heading = slotHeading(session.slot);
  const rank = session.rank;

  return (
    <section className="panel picker-flow" id="card-picker" data-testid="card-picker" aria-label="Card picker">
      <div className="panel-head" aria-live="polite">
        <div>
          <p className="step-kicker">{session.step === 'rank' ? 'Step 1 of 2' : 'Step 2 of 2'}</p>
          <h2 id="picker-title">{session.step === 'rank' ? 'Choose a rank' : 'Choose a suit'}</h2>
        </div>
        <p>
          {heading}
          {rank ? ` · ${RANK_WORD[rank]}` : ''}
        </p>
      </div>
      {session.step === 'rank' ? (
        <div className="rank-grid" role="group" aria-label="Ranks from 2 through ace">
          {PICKER_RANKS.map((choice) => {
            const blocked = rankBlocked(choice, taken);
            return (
              <button
                key={choice}
                type="button"
                className={`rank-choice${blocked ? ' used' : ''}`}
                disabled={blocked}
                data-testid={`rank-${choice}`}
                aria-label={blocked ? `${rankLabel(choice)}, used` : rankLabel(choice)}
                onClick={() => onRank(choice)}
              >
                <span>{rankLabel(choice)}</span>
                {blocked && <small>Used</small>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="suit-grid" role="group" aria-label={`Suits for ${rank ? RANK_WORD[rank] : 'the card'}`}>
          {SUITS.map((suit) => {
            const blocked = rank ? suitBlocked(rank, suit, taken) : true;
            const selected = Boolean(current && rank && current.rank === rank && current.suit === suit);
            return (
              <button
                key={suit}
                type="button"
                className={`suit-choice ${isRed(suit) ? 'red' : 'black'}${blocked ? ' used' : ''}${selected ? ' on' : ''}`}
                disabled={blocked}
                data-testid={`suit-${suit}`}
                aria-label={
                  blocked ? `${suitName(suit)}, used` : selected ? `${suitName(suit)}, selected` : suitName(suit)
                }
                onClick={() => onSuit(suit)}
              >
                <span className="glyph" aria-hidden="true">
                  {SUIT_GLYPH[suit]}
                </span>
                <span className="suit-name">{suitName(suit)}</span>
                {blocked && <small>Used</small>}
                {!blocked && selected && <small>Selected</small>}
              </button>
            );
          })}
        </div>
      )}
      <div className="picker-nav">
        <button type="button" className="quiet" data-testid="picker-back" onClick={onBack}>
          Back
        </button>
        {current && (
          <button type="button" className="quiet" data-testid="picker-clear" onClick={onClear}>
            Remove card
          </button>
        )}
      </div>
    </section>
  );
}
