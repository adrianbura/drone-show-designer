# Drone Show Designer

You are not building a toy demo.

You are acting as a senior engineering team consisting of:

- Principal software architect

- Senior React/TypeScript engineer

- Senior Python engineer

- 3D graphics engineer

- computational geometry engineer

- robotics/drone systems engineer

- PX4/MAVLink/MAVSDK engineer

- UI/UX designer specialized in professional creative tools

- QA/test automation engineer

- DevOps engineer

We are building a professional internal-use Drone Show Design and Simulation Studio.

The application must be architected from day one so it can eventually support 200+ drones, while initially being developed and tested with virtual drones.

IMPORTANT:

Do NOT reinvent existing mature open-source drone infrastructure.

Do NOT implement our own autopilot.

Do NOT implement our own MAVLink protocol.

Do NOT attempt to rewrite PX4.

Do NOT attempt to rewrite MAVSDK.

Do NOT copy large portions of Skybrush source code into the application unless explicitly required and license-compatible.

Instead, build a clean orchestration and creative-design layer that can integrate with established open-source ecosystems through well-defined adapters.

The product is initially intended for private/internal use.

The application must be designed so that external distribution or commercial redistribution of GPL-derived components would trigger a license/compliance review.

--------------------------------------------------

1. PRODUCT VISION

--------------------------------------------------

Create a professional application called:

DRONE SHOW STUDIO

Purpose:

Allow an operator to design, preview, validate, simulate and export synchronized drone light shows.

The application should eventually allow a user to:

1. Create a project.

2. Select the number of drones.

3. Define a show area.

4. Create formations.

5. Convert text, SVG logos, images and 3D objects into drone formations.

6. Create transitions between formations.

7. Create choreography on a timeline.

8. Import music.

9. Analyze music timing.

10. Synchronize formations/effects with music.

11. Control drone RGB lighting.

12. Preview everything in real-time 3D.

13. Validate trajectories.

14. Detect collision risks.

15. Detect excessive velocity.

16. Detect excessive acceleration.

17. Detect excessive yaw rate.

18. Validate takeoff and landing.

19. Export compatible show data.

20. Integrate with Skybrush.

21. Integrate with PX4/MAVSDK/MAVLink-based simulation.

22. Eventually integrate with real drone fleets.

The application should feel like:

After Effects + Blender-style 3D timeline + drone-show choreography software.

It should NOT feel like a generic admin dashboard.

--------------------------------------------------

2. CORE ARCHITECTURAL PRINCIPLE

--------------------------------------------------

Use a modular architecture.

The application consists of:

A. Creative UI

B. 3D Visualization

C. Show Core

D. Formation Engine

E. Choreography Engine

F. Trajectory Engine

G. Safety Validation Engine

H. Audio/Music Engine

I. Light Program Engine

J. Simulation Adapter

K. Skybrush Adapter

L. MAVSDK/MAVLink Adapter

M. PX4/SITL Adapter

N. Export Adapter Layer

O. Project Persistence

P. Job/Worker System

Q. Logging and Diagnostics

The frontend must NOT directly implement complex robotics algorithms.

Frontend:

React + TypeScript

3D:

Three.js / React Three Fiber

Backend:

Python + FastAPI

Heavy computation:

Python workers/services

Communication:

REST API for normal operations.

WebSockets for real-time progress, simulation state, telemetry and job status.

Database:

PostgreSQL in production architecture.

For local development, allow SQLite fallback if necessary.

Do not tightly couple the UI to any specific drone platform.

--------------------------------------------------

3. TARGET ARCHITECTURE

--------------------------------------------------

Implement this conceptual architecture:

USER

 |

 v

DRONE SHOW STUDIO UI

 |

 v

PROJECT API

 |

 +----------------------------+

 |                            |

 v                            v

SHOW CORE                 JOB MANAGER

 |                            |

 +------------+---------------+

              |

              v

        COMPUTATION LAYER

              |

       +------+------+------+------+------+

       |      |      |      |      |      |

       v      v      v      v      v      v

 Formation  Traj.  Safety Audio Lights Export

 Engine    Engine  Engine Engine Engine Engine

       |

       v

ADAPTER LAYER

 |

 +-------------+--------------+-------------+

 |             |              |             |

 v             v              v             v

Skybrush     PX4/SITL       MAVSDK       Generic

Adapter      Adapter        Adapter       Export

 |

 v

External Ecosystem

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://drone-show-designer.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/94068790-81d9-45d0-9027-a97ca6f0563a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
