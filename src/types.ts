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
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
  };
}
