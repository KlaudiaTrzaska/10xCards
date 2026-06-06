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
        };
        Insert: {
          id?: string;
          user_id: string;
          generation_id?: string | null;
          front: string;
          back: string;
          status?: "draft" | "accepted";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          generation_id?: string | null;
          front?: string;
          back?: string;
          status?: "draft" | "accepted";
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
  };
}
