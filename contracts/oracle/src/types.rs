use soroban_sdk::{contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug)]
pub struct InstanceState {
    pub admin: Address,
    pub result_count: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MatchResult {
    Player1Wins,
    Player2Wins,
    Draw,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ResultEntry {
    pub game_id: String,
    pub result: MatchResult,
    pub submitted_ledger: u32,
}

#[contracttype]
pub enum DataKey {
    InstanceState,
    Result(u64), // keyed by match_id
}
