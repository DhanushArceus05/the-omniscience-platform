# System Architecture

Version: 1.0
Status: Approved
Last Updated: 2026-07-11

## Style

Monorepo + modular monolith first; microservices later only if needed.

## Apps

- React/Vite web app
- NestJS API
- FastAPI AI/ML service

## Flow

User → Assistant → OmniCore → capability plan → OmniProvider/Model Manager → specialized modules → validator/reviewer → response composer.

## OmniCore

Fast rules, intent intelligence, complex-task planner, pipeline builder, execution manager, validation, confidence, fallback and response composition.

## Provider Rule

Business logic requests capabilities, never vendor names.
