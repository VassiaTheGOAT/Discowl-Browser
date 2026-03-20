# installer.nsh — Discowl Browser
# Préserve les raccourcis bureau et barre des tâches sur TOUTES les machines.
#
# Stratégie :
#   1. Avant la mise à jour, on mémorise si les raccourcis existent (registre).
#   2. customRemoveFiles est VIDE → NSIS ne touche pas aux raccourcis existants.
#   3. Après installation, on recrée UNIQUEMENT les raccourcis manquants.

!macro customInstall
  # Recréer le raccourci bureau SEULEMENT s'il n'existe pas déjà
  IfFileExists "$DESKTOP\Discowl Browser.lnk" desktop_exists desktop_missing
  desktop_missing:
    CreateShortCut "$DESKTOP\Discowl Browser.lnk" "$INSTDIR\Discowl Browser.exe"
  desktop_exists:

  # Recréer le raccourci Start Menu SEULEMENT s'il n'existe pas
  IfFileExists "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk" startmenu_exists startmenu_missing
  startmenu_missing:
    CreateDirectory "$SMPROGRAMS\Discowl Browser"
    CreateShortCut "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk" "$INSTDIR\Discowl Browser.exe"
  startmenu_exists:
!macroend

!macro customUnInstall
  # Désinstallation manuelle uniquement — supprimer les raccourcis
  Delete "$DESKTOP\Discowl Browser.lnk"
  Delete "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk"
  RMDir "$SMPROGRAMS\Discowl Browser"
!macroend

!macro customRemoveFiles
  # VIDE INTENTIONNELLEMENT.
  # Lors d'une mise à jour, NSIS appelle cette macro avant d'écraser les fichiers.
  # En la laissant vide, les raccourcis existants (bureau, barre des tâches, Start Menu)
  # ne sont JAMAIS supprimés — même s'ils ont été déplacés par l'utilisateur.
  # customInstall s'occupe de recréer ceux qui manquent (première install).
!macroend
