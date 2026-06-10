export type FlashcardStatus = "draft" | "accepted";

export interface Generation {
  id: string;
  user_id: string;
  source_text: string;
  card_count_requested: number;
  model: string;
  created_at: string;
}

export interface Flashcard {
  id: string;
  user_id: string;
  generation_id: string | null;
  front: string;
  back: string;
  status: FlashcardStatus;
  created_at: string;
  first_reviewed_at: string | null;
  // FSRS scheduling fields — null when card has never been reviewed
  fsrs_due: string | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_scheduled_days: number | null;
  fsrs_learning_steps: number | null;
  fsrs_reps: number | null;
  fsrs_lapses: number | null;
  fsrs_state: number | null;
  fsrs_last_review: string | null;
}

// Input to POST /api/generate
export interface GenerateRequestDTO {
  sourceText: string;
  count: 5 | 10 | 15;
}

// Saved flashcards returned from POST /api/generate
export interface GenerateResponseDTO {
  generationId: string;
  cards: Flashcard[];
}

// Input to POST /api/save-deck
export interface SaveCurationRequestDTO {
  generationId: string;
  accepted: string[]; // card IDs to mark status='accepted'
  edited: { id: string; front: string; back: string }[]; // cards to update content + mark accepted
  discarded: string[]; // card IDs to hard-delete
}

// Response from POST /api/save-deck
export interface SaveCurationResponseDTO {
  savedCount: number; // accepted.length + edited.length
}

// Response from GET /api/deck
export interface DeckListResponseDTO {
  cards: Flashcard[];
  total: number;
  page: number;
  pageSize: number;
}

// Input to POST /api/deck (manual card creation)
export interface CreateCardRequestDTO {
  front: string;
  back: string;
}

// Input to PATCH /api/deck/[id]
export interface UpdateCardRequestDTO {
  front: string;
  back: string;
}

// Response from POST /api/deck and PATCH /api/deck/[id]
export interface CardMutationResponseDTO {
  card: Flashcard;
}

// Review outcome grades mapping to FSRS ratings 1–4
export type ReviewOutcome = "again" | "hard" | "good" | "easy";

// A single review log entry (append-only)
export interface ReviewLog {
  id: string;
  user_id: string;
  card_id: string;
  rating: number;
  state: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  reviewed_at: string;
}

// Card fields returned to the study session (subset of Flashcard)
export type StudyCardDTO = Pick<
  Flashcard,
  | "id"
  | "front"
  | "back"
  | "first_reviewed_at"
  | "fsrs_due"
  | "fsrs_stability"
  | "fsrs_difficulty"
  | "fsrs_scheduled_days"
  | "fsrs_learning_steps"
  | "fsrs_reps"
  | "fsrs_lapses"
  | "fsrs_state"
  | "fsrs_last_review"
>;

// Response from GET /api/study/due
export interface StudyDueResponseDTO {
  cards: StudyCardDTO[];
  total_due: number;
  total_accepted: number;
}

// Input to POST /api/study/review
export interface SubmitReviewRequestDTO {
  cardId: string;
  outcome: ReviewOutcome;
}

// Response from POST /api/study/review
export interface SubmitReviewResponseDTO {
  scheduledFor: string;
  outcome: ReviewOutcome;
}

// Supabase Database type — keeps table operations fully typed without generated types
export interface Database {
  public: {
    Tables: {
      generations: {
        Row: {
          id: string;
          user_id: string;
          source_text: string;
          card_count_requested: number;
          model: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_text: string;
          card_count_requested: number;
          model: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_text?: string;
          card_count_requested?: number;
          model?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      flashcards: {
        Row: {
          id: string;
          user_id: string;
          generation_id: string | null;
          front: string;
          back: string;
          status: "draft" | "accepted";
          created_at: string;
          first_reviewed_at: string | null;
          fsrs_due: string | null;
          fsrs_stability: number | null;
          fsrs_difficulty: number | null;
          fsrs_scheduled_days: number | null;
          fsrs_learning_steps: number | null;
          fsrs_reps: number | null;
          fsrs_lapses: number | null;
          fsrs_state: number | null;
          fsrs_last_review: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          generation_id?: string | null;
          front: string;
          back: string;
          status?: "draft" | "accepted";
          created_at?: string;
          first_reviewed_at?: string | null;
          fsrs_due?: string | null;
          fsrs_stability?: number | null;
          fsrs_difficulty?: number | null;
          fsrs_scheduled_days?: number | null;
          fsrs_learning_steps?: number | null;
          fsrs_reps?: number | null;
          fsrs_lapses?: number | null;
          fsrs_state?: number | null;
          fsrs_last_review?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          generation_id?: string | null;
          front?: string;
          back?: string;
          status?: "draft" | "accepted";
          created_at?: string;
          first_reviewed_at?: string | null;
          fsrs_due?: string | null;
          fsrs_stability?: number | null;
          fsrs_difficulty?: number | null;
          fsrs_scheduled_days?: number | null;
          fsrs_learning_steps?: number | null;
          fsrs_reps?: number | null;
          fsrs_lapses?: number | null;
          fsrs_state?: number | null;
          fsrs_last_review?: string | null;
        };
        Relationships: [];
      };
      review_logs: {
        Row: {
          id: string;
          user_id: string;
          card_id: string;
          rating: number;
          state: number;
          stability: number;
          difficulty: number;
          scheduled_days: number;
          reviewed_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          card_id: string;
          rating: number;
          state: number;
          stability: number;
          difficulty: number;
          scheduled_days: number;
          reviewed_at?: string;
        };
        Update: Record<never, never>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
  };
}
